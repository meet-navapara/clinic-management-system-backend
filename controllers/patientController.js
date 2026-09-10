import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import PatientNote from '../models/PatientNote.js';
import PatientEvent from '../models/PatientEvent.js';
import { generatePatientCode, deriveAge, splitName } from '../utils/patientHelpers.js';
import { recordPatientEvent } from '../utils/patientTimeline.js';
import { notifyDoctor } from '../utils/doctorNotify.js';
import { ACTIVE_APPOINTMENT_STATUSES } from '../models/Appointment.js';
import { normalizeStatus } from '../utils/appointmentTransitions.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildDisplayName = ({ firstName, lastName, preferredName, name }) => {
  if (name?.trim()) return name.trim();
  const parts = [firstName, lastName].filter((p) => p?.trim());
  if (parts.length) return parts.join(' ').trim();
  return preferredName?.trim() || '';
};

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[\n,;]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const assertDoctorOwnsPatient = (req, patient) => {
  if (req.user.role === 'doctor' && String(patient.doctorId) !== String(req.user._id)) {
    const err = new Error('Patient not found.');
    err.status = 404;
    throw err;
  }
};

const visitSnippet = (a) =>
  a
    ? {
        date: a.appointmentDate,
        timeSlot: a.timeSlot,
        status: a.status,
      }
    : null;

const attachVisitSummary = async (patients, doctorId) => {
  if (!patients.length) return [];
  const ids = patients.map((p) => p._id);
  const now = new Date();
  const appts = await Appointment.find({
    patientId: { $in: ids },
    doctor: doctorId,
  })
    .select('patientId appointmentDate timeSlot status')
    .sort({ appointmentDate: -1 })
    .lean();

  const byPatient = {};
  for (const a of appts) {
    const pid = String(a.patientId);
    if (!byPatient[pid]) byPatient[pid] = [];
    byPatient[pid].push(a);
  }

  return patients.map((p) => {
    const obj = typeof p.toObject === 'function' ? p.toObject() : { ...p };
    const list = byPatient[String(p._id)] || [];
    const lastVisit = list.find((a) => new Date(a.appointmentDate) <= now) || null;
    const nextAppointment = list
      .filter(
        (a) =>
          new Date(a.appointmentDate) >= now &&
          ACTIVE_APPOINTMENT_STATUSES.includes(normalizeStatus(a.status))
      )
      .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate))[0];

    obj.lastVisit = visitSnippet(lastVisit);
    obj.nextAppointment = visitSnippet(nextAppointment);
    return obj;
  });
};

export const createPatient = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can add patients.' });
    }
    if (req.user.approvalStatus !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Your account is awaiting admin approval.',
      });
    }
    if (!req.user.clinicId) {
      return res.status(400).json({ success: false, message: 'Doctor has no clinic assigned.' });
    }

    const body = req.body || {};
    let { firstName, lastName } = body;
    if (!firstName && body.name) {
      const split = splitName(body.name);
      firstName = split.firstName;
      lastName = split.lastName;
    }

    const name = buildDisplayName({
      firstName,
      lastName,
      preferredName: body.preferredName,
      name: body.name,
    });
    const phone = body.phone?.trim();

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required.' });
    }

    const existing = await Patient.findOne({
      doctorId: req.user._id,
      phone,
      isActive: true,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A patient with this phone already exists in your list.',
        patient: existing,
      });
    }

    const dateOfBirth = body.dateOfBirth || null;
    const age =
      body.age !== undefined && body.age !== ''
        ? Number(body.age)
        : deriveAge(dateOfBirth);

    const clinical = {
      allergies: normalizeList(body.allergies ?? body.clinical?.allergies),
      conditions: normalizeList(body.conditions ?? body.clinical?.conditions),
      medications: normalizeList(body.medications ?? body.clinical?.medications),
      medicalHistory: body.medicalHistory || body.clinical?.medicalHistory || '',
      familyHistory: body.familyHistory || body.clinical?.familyHistory || '',
      surgeries: body.surgeries || body.clinical?.surgeries || '',
      alerts: normalizeList(body.alerts ?? body.clinical?.alerts),
    };

    const patientCode = await generatePatientCode();

    const patient = await Patient.create({
      clinicId: req.user.clinicId,
      doctorId: req.user._id,
      patientCode,
      firstName: firstName || '',
      lastName: lastName || '',
      preferredName: body.preferredName || '',
      name,
      phone,
      email: body.email?.trim() || '',
      dateOfBirth,
      age,
      gender: body.gender || '',
      address: body.address || '',
      city: body.city || '',
      state: body.state || '',
      postalCode: body.postalCode || '',
      emergencyContact: {
        name: body.emergencyContactName || body.emergencyContact?.name || '',
        relationship:
          body.emergencyContactRelationship || body.emergencyContact?.relationship || '',
        phone: body.emergencyContactPhone || body.emergencyContact?.phone || '',
      },
      clinical,
      medicalHistory: clinical.medicalHistory,
      notes: body.notes || '',
    });

    await recordPatientEvent({
      clinicId: patient.clinicId,
      doctorId: req.user._id,
      patientId: patient._id,
      type: 'patient_created',
      title: 'Patient created',
      detail: `${patient.name} (${patient.patientCode})`,
    });

    await notifyDoctor({
      doctorId: req.user._id,
      clinicId: patient.clinicId,
      type: 'patient_added',
      title: 'New patient added',
      body: `${patient.name} · ${patient.patientCode}`,
      link: `/doctor/patients/${patient._id}`,
      metadata: { patientId: patient._id },
    });

    res.status(201).json({ success: true, message: 'Patient added.', patient });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

export const listMyPatients = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can list patients.' });
    }

    const { search, gender, page = 1, limit = 20 } = req.query;
    const filter = { doctorId: req.user._id, isActive: true };

    if (gender) filter.gender = gender;

    if (search?.trim()) {
      const q = escapeRegex(search.trim());
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { firstName: new RegExp(q, 'i') },
        { lastName: new RegExp(q, 'i') },
        { phone: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { patientCode: new RegExp(q, 'i') },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [patients, total] = await Promise.all([
      Patient.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Patient.countDocuments(filter),
    ]);

    const withVisits = await attachVisitSummary(patients, req.user._id);

    res.json({
      success: true,
      count: withVisits.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      patients: withVisits,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient || !patient.isActive) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    if (req.user.role === 'doctor') {
      assertDoctorOwnsPatient(req, patient);
    } else if (['clinic_admin', 'super_admin'].includes(req.user.role)) {
      if (
        req.user.role !== 'super_admin' &&
        String(patient.clinicId) !== String(req.user.clinicId)
      ) {
        return res.status(403).json({ success: false, message: 'Outside your clinic.' });
      }
    } else {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const appointments = await Appointment.find({ patientId: patient._id })
      .sort({ appointmentDate: -1, timeSlot: -1 })
      .limit(100)
      .select('appointmentDate timeSlot status reason appointmentType durationMinutes notes createdAt');

    const upcoming = appointments.filter((a) =>
      ACTIVE_APPOINTMENT_STATUSES.includes(normalizeStatus(a.status))
    );
    const past = appointments.filter(
      (a) => !ACTIVE_APPOINTMENT_STATUSES.includes(normalizeStatus(a.status))
    );

    const [notes, timeline] = await Promise.all([
      PatientNote.find({ patientId: patient._id, doctorId: patient.doctorId }).sort({
        createdAt: -1,
      }),
      PatientEvent.find({ patientId: patient._id }).sort({ createdAt: -1 }).limit(100),
    ]);

    res.json({
      success: true,
      patient,
      appointments: { upcoming, past, all: appointments },
      notes,
      timeline,
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

export const updatePatient = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can update patients.' });
    }

    const patient = await Patient.findById(req.params.id);
    if (!patient || !patient.isActive) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }
    assertDoctorOwnsPatient(req, patient);

    const body = req.body || {};
    const fields = [
      'firstName',
      'lastName',
      'preferredName',
      'phone',
      'email',
      'gender',
      'address',
      'city',
      'state',
      'postalCode',
      'notes',
      'medicalHistory',
    ];

    for (const field of fields) {
      if (body[field] !== undefined) patient[field] = body[field];
    }

    if (body.name !== undefined) patient.name = body.name;
    if (body.dateOfBirth !== undefined) {
      patient.dateOfBirth = body.dateOfBirth || null;
      patient.age = deriveAge(patient.dateOfBirth);
    }
    if (body.age !== undefined && body.age !== '') patient.age = Number(body.age);

    if (
      body.emergencyContact ||
      body.emergencyContactName !== undefined ||
      body.emergencyContactPhone !== undefined
    ) {
      patient.emergencyContact = {
        name: body.emergencyContactName ?? body.emergencyContact?.name ?? patient.emergencyContact?.name,
        relationship:
          body.emergencyContactRelationship ??
          body.emergencyContact?.relationship ??
          patient.emergencyContact?.relationship,
        phone:
          body.emergencyContactPhone ??
          body.emergencyContact?.phone ??
          patient.emergencyContact?.phone,
      };
    }

    const clinical = { ...(patient.clinical?.toObject?.() || patient.clinical || {}) };
    if (body.clinical || body.allergies || body.conditions || body.medications || body.alerts) {
      if (body.allergies !== undefined || body.clinical?.allergies !== undefined) {
        clinical.allergies = normalizeList(body.allergies ?? body.clinical?.allergies);
      }
      if (body.conditions !== undefined || body.clinical?.conditions !== undefined) {
        clinical.conditions = normalizeList(body.conditions ?? body.clinical?.conditions);
      }
      if (body.medications !== undefined || body.clinical?.medications !== undefined) {
        clinical.medications = normalizeList(body.medications ?? body.clinical?.medications);
      }
      if (body.alerts !== undefined || body.clinical?.alerts !== undefined) {
        clinical.alerts = normalizeList(body.alerts ?? body.clinical?.alerts);
      }
      if (body.familyHistory !== undefined || body.clinical?.familyHistory !== undefined) {
        clinical.familyHistory = body.familyHistory ?? body.clinical?.familyHistory ?? '';
      }
      if (body.surgeries !== undefined || body.clinical?.surgeries !== undefined) {
        clinical.surgeries = body.surgeries ?? body.clinical?.surgeries ?? '';
      }
      if (body.medicalHistory !== undefined || body.clinical?.medicalHistory !== undefined) {
        clinical.medicalHistory = body.medicalHistory ?? body.clinical?.medicalHistory ?? '';
        patient.medicalHistory = clinical.medicalHistory;
      }
      patient.clinical = clinical;
    }

    patient.name = buildDisplayName({
      firstName: patient.firstName,
      lastName: patient.lastName,
      preferredName: patient.preferredName,
      name: patient.name,
    });

    await patient.save();

    await recordPatientEvent({
      clinicId: patient.clinicId,
      doctorId: req.user._id,
      patientId: patient._id,
      type: 'patient_updated',
      title: 'Patient information updated',
    });

    res.json({ success: true, message: 'Patient updated.', patient });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

export const addPatientNote = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can add notes.' });
    }
    const patient = await Patient.findById(req.params.id);
    if (!patient || !patient.isActive) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }
    assertDoctorOwnsPatient(req, patient);

    const body = (req.body?.body || req.body?.note || '').trim();
    if (!body) {
      return res.status(400).json({ success: false, message: 'Note body is required.' });
    }

    const note = await PatientNote.create({
      clinicId: patient.clinicId,
      doctorId: req.user._id,
      patientId: patient._id,
      body,
    });

    await recordPatientEvent({
      clinicId: patient.clinicId,
      doctorId: req.user._id,
      patientId: patient._id,
      type: 'note_added',
      title: 'Note added',
      detail: body.slice(0, 120),
    });

    res.status(201).json({ success: true, note });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};
