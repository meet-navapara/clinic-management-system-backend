import { validationResult } from 'express-validator';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import { buildWhatsAppUrl } from '../utils/whatsapp.js';
import { isSameClinic } from '../middleware/auth.js';

const STAFF_ROLES = ['receptionist', 'clinic_admin', 'super_admin'];

const APPT_POPULATE = [
  { path: 'patient', select: 'name email phone profilePhoto clinicId' },
  { path: 'doctor', select: 'name specialization consultationFee phone profilePhoto clinicId' },
];

const populateAppointmentQuery = (query) => query.populate(APPT_POPULATE);
const assertSlotAvailable = async ({ doctor, doctorId, date, timeSlot }) => {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

  if (!doctor.availableDays.includes(dayName)) {
    return { ok: false, status: 400, message: `Doctor is not available on ${dayName}.` };
  }

  if (!doctor.availableSlots.includes(timeSlot)) {
    return { ok: false, status: 400, message: 'Selected time slot is not available.' };
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const existing = await Appointment.findOne({
    doctor: doctorId,
    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    timeSlot,
    status: { $ne: 'cancelled' },
  });

  if (existing) {
    return {
      ok: false,
      status: 400,
      message: 'This time slot is already booked. Please choose another.',
    };
  }

  return { ok: true };
};

export const createAppointment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { doctorId, appointmentDate, timeSlot, reason, patientId } = req.body;
    const isStaff = STAFF_ROLES.includes(req.user.role);

    let patient = req.user;
    if (isStaff) {
      if (!patientId) {
        return res.status(400).json({
          success: false,
          message: 'patientId is required when booking as clinic staff.',
        });
      }

      patient = await User.findOne({ _id: patientId, role: 'patient', isActive: true });
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient not found.' });
      }

      if (req.user.role !== 'super_admin' && !isSameClinic(req.user, patient.clinicId)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot book for a patient outside your clinic.',
        });
      }
    } else if (req.user.role !== 'patient') {
      return res.status(403).json({ success: false, message: 'Not authorized to book appointments.' });
    }

    const doctor = await User.findOne({ _id: doctorId, role: 'doctor', isActive: true });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    // Clinic isolation: doctor and patient must share a clinic when both have clinicId
    if (patient.clinicId && doctor.clinicId && String(patient.clinicId) !== String(doctor.clinicId)) {
      return res.status(403).json({
        success: false,
        message: 'Doctor and patient belong to different clinics.',
      });
    }

    if (isStaff && req.user.role !== 'super_admin' && !isSameClinic(req.user, doctor.clinicId)) {
      return res.status(403).json({
        success: false,
        message: 'Cannot book with a doctor outside your clinic.',
      });
    }

    const date = new Date(appointmentDate);
    const slotCheck = await assertSlotAvailable({ doctor, doctorId, date, timeSlot });
    if (!slotCheck.ok) {
      return res.status(slotCheck.status).json({ success: false, message: slotCheck.message });
    }

    const clinicId = doctor.clinicId || patient.clinicId || req.user.clinicId || null;

    const appointment = await Appointment.create({
      clinicId,
      patient: patient._id,
      doctor: doctorId,
      appointmentDate: date,
      timeSlot,
      reason,
    });

    await appointment.populate(APPT_POPULATE);

    const whatsappUrl = buildWhatsAppUrl(appointment, appointment.patient, appointment.doctor);

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully!',
      appointment,
      whatsappUrl,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This time slot is already booked.',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyAppointments = async (req, res) => {
  try {
    const { doctorId, status, date } = req.query;
    let filter = {};

    if (req.user.role === 'doctor') {
      filter = { doctor: req.user._id };
    } else if (req.user.role === 'patient') {
      filter = { patient: req.user._id };
    } else if (STAFF_ROLES.includes(req.user.role)) {
      if (req.user.role !== 'super_admin' && !req.user.clinicId) {
        return res.status(403).json({
          success: false,
          message: 'No clinic is associated with this account.',
        });
      }
      filter =
        req.user.role === 'super_admin'
          ? {}
          : { clinicId: req.user.clinicId };
    } else {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    if (doctorId && ['receptionist', 'clinic_admin', 'super_admin', 'patient'].includes(req.user.role)) {
      filter.doctor = doctorId;
    }

    if (status) {
      filter.status = status;
    }

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
    }

    const appointments = await populateAppointmentQuery(
      Appointment.find(filter).sort({ appointmentDate: -1, timeSlot: 1 })
    );

    res.json({ success: true, count: appointments.length, appointments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Lookup patient by phone or email within the staff member's clinic. */
export const findClinicPatient = async (req, res) => {
  try {
    if (!STAFF_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const q = String(req.query.q || '').trim();
    if (!q || q.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Enter at least 3 characters of phone or email.',
      });
    }

    const filter = {
      role: 'patient',
      isActive: true,
      $or: [
        { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { phone: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } },
      ],
    };

    if (req.user.role !== 'super_admin') {
      filter.clinicId = req.user.clinicId;
    }

    const patients = await User.find(filter)
      .select('name email phone clinicId profilePhoto')
      .limit(10);

    res.json({ success: true, count: patients.length, patients });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAppointmentStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    const isDoctor =
      req.user.role === 'doctor' && appointment.doctor.toString() === req.user._id.toString();
    const isPatient =
      req.user.role === 'patient' && appointment.patient.toString() === req.user._id.toString();
    const isClinicStaff =
      STAFF_ROLES.includes(req.user.role) &&
      (req.user.role === 'super_admin' || isSameClinic(req.user, appointment.clinicId));

    if (!isDoctor && !isPatient && !isClinicStaff) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    if (req.user.role === 'patient' && status !== 'cancelled') {
      return res.status(403).json({
        success: false,
        message: 'Patients can only cancel appointments.',
      });
    }

    // Receptionists may confirm/cancel but not mark clinical completion
    if (req.user.role === 'receptionist' && !['confirmed', 'cancelled', 'pending'].includes(status)) {
      return res.status(403).json({
        success: false,
        message: 'Receptionists cannot mark appointments as completed.',
      });
    }

    appointment.status = status;
    await appointment.save();

    await appointment.populate(APPT_POPULATE);

    res.json({ success: true, message: `Appointment ${status}.`, appointment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getWhatsAppLink = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('patient', 'name email phone profilePhoto')
      .populate('doctor', 'name specialization phone profilePhoto');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    if (!appointment.patient || !appointment.doctor) {
      return res.status(400).json({
        success: false,
        message: 'Cannot generate WhatsApp link — appointment has missing patient or doctor data.',
      });
    }

    const userId = req.user._id.toString();
    const patientId = appointment.patient._id.toString();
    const doctorId = appointment.doctor._id.toString();
    const isOwner = patientId === userId || doctorId === userId;
    const isClinicStaff =
      STAFF_ROLES.includes(req.user.role) &&
      (req.user.role === 'super_admin' || isSameClinic(req.user, appointment.clinicId));

    if (!isOwner && !isClinicStaff) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const audience = req.user.role === 'doctor' ? 'doctor' : 'clinic';
    const whatsappUrl = buildWhatsAppUrl(
      appointment,
      appointment.patient,
      appointment.doctor,
      audience
    );

    res.json({ success: true, whatsappUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
