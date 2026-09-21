import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import PatientNote from '../models/PatientNote.js';
import PatientEvent from '../models/PatientEvent.js';
import { generatePatientCode, deriveAge, splitName } from '../utils/patientHelpers.js';
import { recordPatientEvent } from '../utils/patientTimeline.js';
import { notifyDoctor } from '../utils/doctorNotify.js';
import { ACTIVE_APPOINTMENT_STATUSES } from '../models/Appointment.js';
import { normalizeStatus } from '../utils/appointmentTransitions.js';
import { hasPermission, P } from '../utils/permissions.js';
import { tenantFilter, assertBranchAccess, resolveWriteBranchId } from '../utils/branchScope.js';
import User from '../models/User.js';
import { escapeRegex, parsePagination } from '../utils/pagination.js';
import {
  normalizeIndianMobile,
  normalizeEmail,
  phoneMatchVariants,
} from '../utils/normalizeContact.js';
import { writeAudit, AUDIT } from '../utils/audit.js';

const safeClientError = (error, fallback = 'Something went wrong. Please try again.') => {
  if (error?.status && error.status < 500 && error.message) return error.message;
  return fallback;
};

/** Accept Cloudinary/http URLs or small data URLs; reject oversized payloads. */
const sanitizePatientPhoto = (value) => {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 2048);
  if (raw.startsWith('data:image/') && raw.length <= 120000) return raw;
  const err = new Error('Profile photo must be an uploaded image URL.');
  err.status = 400;
  throw err;
};

const buildDisplayName = ({ firstName, middleName, lastName, preferredName, name }) => {
  if (name?.trim()) return name.trim();
  const parts = [firstName, middleName, lastName].filter((p) => p?.trim());
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

const assertClinicPatient = (req, patient) => {
  if (!req.user?.clinicId || String(patient.clinicId) !== String(req.user.clinicId)) {
    const err = new Error('Patient not found.');
    err.status = 404;
    throw err;
  }
  try {
    assertBranchAccess(req.user, patient.branchId);
  } catch {
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
    ...(doctorId ? { doctor: doctorId } : {}),
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
    if (!hasPermission(req.user, P.PATIENTS_MANAGE)) {
      return res.status(403).json({ success: false, message: 'Not authorized to add patients.' });
    }
    if (req.user.role === 'doctor' && req.user.approvalStatus !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Your account is awaiting admin approval.',
      });
    }
    if (!req.user.clinicId) {
      return res.status(400).json({ success: false, message: 'No clinic assigned.' });
    }

    const body = req.body || {};
    let { firstName, middleName, lastName } = body;
    if (!firstName && body.name) {
      const split = splitName(body.name);
      firstName = split.firstName;
      lastName = split.lastName;
      middleName = middleName || '';
    }

    const name = buildDisplayName({
      firstName,
      middleName,
      lastName,
      preferredName: body.preferredName,
      name: body.name,
    });
    const phone = normalizeIndianMobile(body.phone);
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: !phone
          ? 'Mobile number must be exactly 10 digits.'
          : 'Name and phone are required.',
      });
    }
    if (!String(body.gender || '').trim()) {
      return res.status(422).json({ success: false, message: 'Gender is required.' });
    }

    let doctorId = req.user.role === 'doctor' ? req.user._id : req.body.doctorId;
    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'doctorId is required.' });
    }
    if (req.user.role !== 'doctor') {
      const assigned = await User.findOne({
        _id: doctorId,
        role: 'doctor',
        clinicId: req.user.clinicId,
        isActive: { $ne: false },
      }).select('_id');
      if (!assigned) {
        return res.status(403).json({ success: false, message: 'Doctor is outside your clinic.' });
      }
      doctorId = assigned._id;
    }

    const branchId = await resolveWriteBranchId(req.user, req.branchId);

    const existing = await Patient.findOne({
      clinicId: req.user.clinicId,
      doctorId,
      branchId,
      isActive: true,
      phone: { $in: phoneMatchVariants(phone) },
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
      otherHistory: body.otherHistory || body.clinical?.otherHistory || '',
      historyTags: normalizeList(body.historyTags ?? body.clinical?.historyTags),
    };

    const patientCode = await generatePatientCode();
    const emergencyPhoneRaw =
      body.emergencyContactPhone || body.emergencyContact?.phone || '';
    const emergencyPhone = emergencyPhoneRaw
      ? normalizeIndianMobile(emergencyPhoneRaw) || String(emergencyPhoneRaw).trim()
      : '';
    const secondaryPhoneRaw = body.secondaryPhone || '';
    const secondaryPhone = secondaryPhoneRaw
      ? normalizeIndianMobile(secondaryPhoneRaw) || String(secondaryPhoneRaw).trim()
      : '';

    const patient = await Patient.create({
      clinicId: req.user.clinicId,
      doctorId,
      branchId,
      patientCode,
      firstName: firstName || '',
      middleName: middleName || body.middleName || '',
      lastName: lastName || '',
      preferredName: body.preferredName || '',
      name,
      phone,
      secondaryPhone,
      email: normalizeEmail(body.email),
      dateOfBirth,
      age,
      gender: body.gender || '',
      address: body.address || '',
      city: body.city || '',
      area: body.area || '',
      state: body.state || '',
      postalCode: body.postalCode || '',
      bloodGroup: body.bloodGroup || '',
      occupation: body.occupation || '',
      nhId: body.nhId || '',
      aadharNumber: body.aadharNumber || '',
      caseId: body.caseId || '',
      referredBy: body.referredBy || '',
      room: body.room || '',
      patientCategory: body.patientCategory || 'Patient',
      linkedPatientName: body.linkedPatientName || '',
      sendSms: body.sendSms !== undefined ? Boolean(body.sendSms) : true,
      admitPatient: Boolean(body.admitPatient),
      profilePhoto: sanitizePatientPhoto(body.profilePhoto),
      emergencyContact: {
        name: body.emergencyContactName || body.emergencyContact?.name || '',
        relationship:
          body.emergencyContactRelationship || body.emergencyContact?.relationship || '',
        phone: emergencyPhone,
      },
      clinical,
      medicalHistory: clinical.medicalHistory || clinical.otherHistory || '',
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

    await writeAudit({
      clinicId: patient.clinicId,
      branchId: patient.branchId,
      actorId: req.user._id,
      action: AUDIT.PATIENT_CREATED,
      entityType: 'patient',
      entityId: patient._id,
      detail: `${patient.name} · ${patient.patientCode}`,
    });

    await notifyDoctor({
      doctorId,
      clinicId: patient.clinicId,
      type: 'patient_added',
      title: 'New patient added',
      body: `${patient.name} · ${patient.patientCode}`,
      link: `/doctor/patients/${patient._id}`,
      metadata: { patientId: patient._id },
      actorId: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Patient added.', patient });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: safeClientError(error) });
  }
};

export const listMyPatients = async (req, res) => {
  try {
    const { search, gender } = req.query;
    const filter = { isActive: true, ...tenantFilter(req.user, req.branchId) };
    if (!hasPermission(req.user, P.PATIENTS_VIEW)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    if (req.user.role === 'doctor' && req.query.mine === '1') filter.doctorId = req.user._id;
    else if (req.query.doctorId) filter.doctorId = req.query.doctorId;

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

    const pageInfo = parsePagination(req.query, { page: 1, limit: 20, max: 100 });
    const { page: pageNum, limit: limitNum, skip } = pageInfo;

    const [patients, total] = await Promise.all([
      Patient.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Patient.countDocuments(filter),
    ]);

    const withVisits = await attachVisitSummary(patients, null);

    res.json({
      success: true,
      count: withVisits.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      limit: limitNum,
      patients: withVisits,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

export const getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient || !patient.isActive) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    assertClinicPatient(req, patient);

    const appointments = await Appointment.find({ patientId: patient._id })
      .sort({ appointmentDate: -1, timeSlot: -1 })
      .limit(100)
      .select('appointmentDate timeSlot status reason appointmentType durationMinutes notes createdAt');

    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const upcoming = appointments.filter((a) => {
      const active = ACTIVE_APPOINTMENT_STATUSES.includes(normalizeStatus(a.status));
      return active && new Date(a.appointmentDate) >= startToday;
    });
    const past = appointments.filter((a) => {
      const active = ACTIVE_APPOINTMENT_STATUSES.includes(normalizeStatus(a.status));
      return !active || new Date(a.appointmentDate) < startToday;
    });

    const [notes, timeline] = await Promise.all([
      PatientNote.find({ patientId: patient._id, clinicId: patient.clinicId })
        .sort({ createdAt: -1 })
        .populate('doctorId', 'name role'),
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
    if (!hasPermission(req.user, P.PATIENTS_MANAGE)) {
      return res.status(403).json({ success: false, message: 'Not authorized to update patients.' });
    }

    const patient = await Patient.findById(req.params.id);
    if (!patient || !patient.isActive) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }
    assertClinicPatient(req, patient);

    const body = req.body || {};
    const fields = [
      'firstName',
      'middleName',
      'lastName',
      'preferredName',
      'gender',
      'address',
      'city',
      'area',
      'state',
      'postalCode',
      'notes',
      'medicalHistory',
      'bloodGroup',
      'occupation',
      'nhId',
      'aadharNumber',
      'caseId',
      'referredBy',
      'room',
      'patientCategory',
      'linkedPatientName',
      'profilePhoto',
    ];

    for (const field of fields) {
      if (body[field] === undefined) continue;
      if (field === 'profilePhoto') {
        patient.profilePhoto = sanitizePatientPhoto(body.profilePhoto);
        continue;
      }
      patient[field] = body[field];
    }

    if (body.sendSms !== undefined) patient.sendSms = Boolean(body.sendSms);
    if (body.admitPatient !== undefined) patient.admitPatient = Boolean(body.admitPatient);

    if (body.phone !== undefined) {
      const phone = normalizeIndianMobile(body.phone);
      if (!phone) {
        return res.status(422).json({
          success: false,
          message: 'Mobile number must be exactly 10 digits.',
        });
      }
      patient.phone = phone;
    }
    if (body.secondaryPhone !== undefined) {
      const raw = body.secondaryPhone;
      patient.secondaryPhone = raw
        ? normalizeIndianMobile(raw) || String(raw).trim()
        : '';
    }
    if (body.email !== undefined) patient.email = normalizeEmail(body.email);

    if (body.name !== undefined) patient.name = body.name;
    if (body.dateOfBirth !== undefined) {
      patient.dateOfBirth = body.dateOfBirth || null;
      patient.age = deriveAge(patient.dateOfBirth);
    }
    if (body.age !== undefined && body.age !== '') patient.age = Number(body.age);

    if (
      body.emergencyContact ||
      body.emergencyContactName !== undefined ||
      body.emergencyContactPhone !== undefined ||
      body.emergencyContactRelationship !== undefined
    ) {
      const rawPhone =
        body.emergencyContactPhone ??
        body.emergencyContact?.phone ??
        patient.emergencyContact?.phone;
      patient.emergencyContact = {
        name: body.emergencyContactName ?? body.emergencyContact?.name ?? patient.emergencyContact?.name,
        relationship:
          body.emergencyContactRelationship ??
          body.emergencyContact?.relationship ??
          patient.emergencyContact?.relationship,
        phone: rawPhone ? normalizeIndianMobile(rawPhone) || String(rawPhone).trim() : '',
      };
    }

    const clinical = { ...(patient.clinical?.toObject?.() || patient.clinical || {}) };
    const hasClinicalUpdate =
      body.clinical ||
      body.allergies !== undefined ||
      body.conditions !== undefined ||
      body.medications !== undefined ||
      body.alerts !== undefined ||
      body.otherHistory !== undefined ||
      body.historyTags !== undefined ||
      body.familyHistory !== undefined ||
      body.surgeries !== undefined ||
      body.medicalHistory !== undefined;

    if (hasClinicalUpdate) {
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
      if (body.historyTags !== undefined || body.clinical?.historyTags !== undefined) {
        clinical.historyTags = normalizeList(body.historyTags ?? body.clinical?.historyTags);
      }
      if (body.familyHistory !== undefined || body.clinical?.familyHistory !== undefined) {
        clinical.familyHistory = body.familyHistory ?? body.clinical?.familyHistory ?? '';
      }
      if (body.surgeries !== undefined || body.clinical?.surgeries !== undefined) {
        clinical.surgeries = body.surgeries ?? body.clinical?.surgeries ?? '';
      }
      if (body.otherHistory !== undefined || body.clinical?.otherHistory !== undefined) {
        clinical.otherHistory = body.otherHistory ?? body.clinical?.otherHistory ?? '';
      }
      if (body.medicalHistory !== undefined || body.clinical?.medicalHistory !== undefined) {
        clinical.medicalHistory = body.medicalHistory ?? body.clinical?.medicalHistory ?? '';
        patient.medicalHistory = clinical.medicalHistory;
      }
      patient.clinical = clinical;
    }

    patient.name = buildDisplayName({
      firstName: patient.firstName,
      middleName: patient.middleName,
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

    await writeAudit({
      clinicId: patient.clinicId,
      branchId: patient.branchId,
      actorId: req.user._id,
      action: AUDIT.PATIENT_UPDATED,
      entityType: 'patient',
      entityId: patient._id,
      detail: `${patient.name} · ${patient.patientCode}`,
    });

    res.json({ success: true, message: 'Patient updated.', patient });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: safeClientError(error) });
  }
};

export const addPatientNote = async (req, res) => {
  try {
    if (!hasPermission(req.user, P.PATIENTS_MANAGE) && !hasPermission(req.user, P.CONSULTATION)) {
      return res.status(403).json({ success: false, message: 'Not authorized to add notes.' });
    }
    const patient = await Patient.findById(req.params.id);
    if (!patient || !patient.isActive) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }
    assertClinicPatient(req, patient);

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
