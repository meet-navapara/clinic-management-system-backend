import { validationResult } from 'express-validator';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import Patient from '../models/Patient.js';
import NotificationLog from '../models/NotificationLog.js';
import { buildWhatsAppUrl } from '../utils/whatsapp.js';
import { isSameClinic } from '../middleware/auth.js';
import {
  scheduleAppointmentReminder,
  cancelAppointmentReminders,
  rescheduleAppointmentReminders,
} from '../utils/notificationService.js';
import {
  assertTransition,
  normalizeStatus,
} from '../utils/appointmentTransitions.js';
import { recordPatientEvent } from '../utils/patientTimeline.js';
import { notifyDoctor } from '../utils/doctorNotify.js';
import { ACTIVE_APPOINTMENT_STATUSES } from '../models/Appointment.js';

const ADMIN_ROLES = ['clinic_admin', 'super_admin'];

const refId = (value) => {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
};

const isCastError = (error) => error?.name === 'CastError' || error?.kind === 'ObjectId';

const APPT_POPULATE = [
  {
    path: 'patientId',
    select:
      'name firstName lastName preferredName patientCode email phone age gender address clinical notes medicalHistory emergencyContact',
  },
  { path: 'patient', select: 'name email phone profilePhoto clinicId' },
  {
    path: 'doctor',
    select: 'name specialization consultationFee phone profilePhoto clinicId availableSlots availableDays practiceSettings',
  },
];

const assertSlotAvailable = async ({ doctor, doctorId, date, timeSlot, excludeId = null }) => {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

  if (!doctor.availableDays?.includes(dayName)) {
    return { ok: false, status: 400, message: `Doctor is not available on ${dayName}.` };
  }

  if (!doctor.availableSlots?.includes(timeSlot)) {
    return { ok: false, status: 400, message: 'Selected time slot is not available.' };
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const existingFilter = {
    doctor: doctorId,
    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    timeSlot,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES.concat(['completed']) },
  };
  if (excludeId) existingFilter._id = { $ne: excludeId };

  const existing = await Appointment.findOne(existingFilter);
  if (existing) {
    return {
      ok: false,
      status: 400,
      message: 'This time slot is already booked. Please choose another.',
    };
  }

  return { ok: true };
};

const assertCanManageAppointment = (req, appointment) => {
  const isDoctor =
    req.user.role === 'doctor' && refId(appointment.doctor) === String(req.user._id);
  const isAdmin =
    ADMIN_ROLES.includes(req.user.role) &&
    (req.user.role === 'super_admin' || isSameClinic(req.user, appointment.clinicId));
  return isDoctor || isAdmin;
};

export const createAppointment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      doctorId,
      appointmentDate,
      timeSlot,
      reason,
      patientId,
      notes,
      appointmentType,
      durationMinutes,
      status: requestedStatus,
    } = req.body;

    const isDoctor = req.user.role === 'doctor';
    const isAdmin = ADMIN_ROLES.includes(req.user.role);

    if (!isDoctor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Appointments are created by the doctor.',
      });
    }

    if (isDoctor && req.user.approvalStatus !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Your doctor account is awaiting admin approval.',
      });
    }

    if (!patientId) {
      return res.status(400).json({
        success: false,
        message: 'patientId is required. Add the patient first, then book.',
      });
    }

    const patientRecord = await Patient.findOne({ _id: patientId, isActive: true });
    if (!patientRecord) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    let doctor;
    if (isDoctor) {
      doctor = req.user;
      if (String(patientRecord.doctorId) !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'This patient is not in your patient list.',
        });
      }
    } else {
      const targetDoctorId = doctorId || patientRecord.doctorId;
      doctor = await User.findOne({
        _id: targetDoctorId,
        role: 'doctor',
        isActive: true,
        approvalStatus: 'approved',
      });
      if (!doctor) {
        return res.status(404).json({ success: false, message: 'Doctor not found or not approved.' });
      }
      if (req.user.role !== 'super_admin' && !isSameClinic(req.user, doctor.clinicId)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot book with a doctor outside your clinic.',
        });
      }
    }

    const date = new Date(appointmentDate);
    const slotCheck = await assertSlotAvailable({
      doctor,
      doctorId: doctor._id,
      date,
      timeSlot,
    });
    if (!slotCheck.ok) {
      return res.status(slotCheck.status).json({ success: false, message: slotCheck.message });
    }

    const duration =
      durationMinutes ||
      doctor.practiceSettings?.defaultDurationMinutes ||
      30;

    const initialStatus =
      requestedStatus && ['scheduled', 'confirmed'].includes(requestedStatus)
        ? requestedStatus
        : 'scheduled';

    const appointment = await Appointment.create({
      clinicId: doctor.clinicId || patientRecord.clinicId || null,
      patientId: patientRecord._id,
      patient: null,
      doctor: doctor._id,
      appointmentDate: date,
      timeSlot,
      reason,
      notes: notes || '',
      appointmentType: appointmentType || 'Consultation',
      durationMinutes: Number(duration) || 30,
      status: initialStatus,
    });

    await appointment.populate(APPT_POPULATE);

    try {
      await scheduleAppointmentReminder(appointment);
      appointment.reminderScheduled = true;
    } catch (err) {
      console.warn('Reminder schedule failed:', err.message);
    }

    await recordPatientEvent({
      clinicId: appointment.clinicId,
      doctorId: doctor._id,
      patientId: patientRecord._id,
      type: 'appointment_scheduled',
      title: 'Appointment scheduled',
      detail: `${timeSlot} · ${appointment.appointmentType}`,
      appointmentId: appointment._id,
    });

    await notifyDoctor({
      doctorId: doctor._id,
      clinicId: appointment.clinicId,
      type: 'appointment_scheduled',
      title: 'Appointment scheduled',
      body: `${patientRecord.name} · ${timeSlot}`,
      link: `/doctor/appointments/${appointment._id}`,
      metadata: { appointmentId: appointment._id },
    });

    let whatsappUrl = '';
    try {
      whatsappUrl = buildWhatsAppUrl(
        appointment,
        appointment.patientId,
        appointment.doctor,
        'doctor'
      );
    } catch {
      whatsappUrl = '';
    }

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
    const { status, date, from, to, patientId, appointmentType } = req.query;
    let filter = {};

    if (req.user.role === 'doctor') {
      filter = { doctor: req.user._id };
    } else if (ADMIN_ROLES.includes(req.user.role)) {
      filter = req.user.role === 'super_admin' ? {} : { clinicId: req.user.clinicId };
    } else {
      return res.status(403).json({
        success: false,
        message: 'Patient self-service appointments are disabled.',
      });
    }

    if (patientId) filter.patientId = patientId;
    if (appointmentType) filter.appointmentType = appointmentType;

    if (status) {
      if (status === 'scheduled') {
        filter.status = { $in: ['scheduled', 'pending'] };
      } else {
        filter.status = status;
      }
    }

    if (from || to) {
      filter.appointmentDate = {};
      if (from) {
        const start = new Date(from);
        start.setHours(0, 0, 0, 0);
        filter.appointmentDate.$gte = start;
      }
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.appointmentDate.$lte = end;
      }
    } else if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
    }

    const appointments = await Appointment.find(filter)
      .populate(APPT_POPULATE)
      .sort({ appointmentDate: 1, timeSlot: 1 });

    res.json({ success: true, count: appointments.length, appointments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAppointmentById = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id).populate(APPT_POPULATE);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    if (!assertCanManageAppointment(req, appointment)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const reminders = await NotificationLog.find({ appointmentId: appointment._id }).sort({
      scheduledAt: 1,
    });

    res.json({ success: true, appointment, reminders });
  } catch (error) {
    if (isCastError(error)) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const findClinicPatient = async (req, res) => {
  try {
    if (req.user.role !== 'doctor' && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Enter at least 2 characters of name, phone, or patient ID.',
      });
    }

    const filter = { isActive: true };
    if (req.user.role === 'doctor') {
      filter.doctorId = req.user._id;
    } else if (req.user.role !== 'super_admin') {
      filter.clinicId = req.user.clinicId;
    }

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { firstName: { $regex: escaped, $options: 'i' } },
      { lastName: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped } },
      { email: { $regex: escaped, $options: 'i' } },
      { patientCode: { $regex: escaped, $options: 'i' } },
    ];

    const patients = await Patient.find(filter).sort({ name: 1 }).limit(20);
    res.json({ success: true, count: patients.length, patients });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAppointmentStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const validStatuses = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'pending'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    if (!assertCanManageAppointment(req, appointment)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    try {
      assertTransition(appointment.status, status);
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    const nextStatus = status === 'pending' ? 'scheduled' : status;
    appointment.status = nextStatus;
    if (notes !== undefined) appointment.notes = notes;
    await appointment.save();

    if (nextStatus === 'cancelled' || nextStatus === 'no_show') {
      await cancelAppointmentReminders(appointment._id);
    }

    const eventType =
      nextStatus === 'completed'
        ? 'appointment_completed'
        : nextStatus === 'cancelled'
          ? 'appointment_cancelled'
          : nextStatus === 'no_show'
            ? 'appointment_no_show'
            : nextStatus === 'confirmed'
              ? 'appointment_confirmed'
              : null;

    if (eventType && appointment.patientId) {
      await recordPatientEvent({
        clinicId: appointment.clinicId,
        doctorId: appointment.doctor,
        patientId: appointment.patientId,
        type: eventType,
        title: `Appointment ${nextStatus.replace('_', ' ')}`,
        appointmentId: appointment._id,
      });
    }

    if (['cancelled', 'completed'].includes(nextStatus)) {
      await notifyDoctor({
        doctorId: appointment.doctor,
        clinicId: appointment.clinicId,
        type: nextStatus === 'cancelled' ? 'appointment_cancelled' : 'appointment_completed',
        title: `Appointment ${nextStatus}`,
        body: '',
        link: `/doctor/appointments/${appointment._id}`,
        metadata: { appointmentId: appointment._id },
      });
    }

    await appointment.populate(APPT_POPULATE);

    res.json({
      success: true,
      message: `Appointment ${normalizeStatus(nextStatus)}.`,
      appointment,
    });
  } catch (error) {
    if (isCastError(error)) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rescheduleAppointment = async (req, res) => {
  try {
    const { appointmentDate, timeSlot, reason, notes, appointmentType, durationMinutes } =
      req.body;

    if (!appointmentDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'appointmentDate and timeSlot are required.',
      });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    if (!assertCanManageAppointment(req, appointment)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const current = normalizeStatus(appointment.status);
    if (!['scheduled', 'confirmed'].includes(current)) {
      return res.status(400).json({
        success: false,
        message: 'Only upcoming appointments can be rescheduled.',
      });
    }

    const doctor = await User.findById(appointment.doctor);
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    const date = new Date(appointmentDate);
    const slotCheck = await assertSlotAvailable({
      doctor,
      doctorId: doctor._id,
      date,
      timeSlot,
      excludeId: appointment._id,
    });
    if (!slotCheck.ok) {
      return res.status(slotCheck.status).json({ success: false, message: slotCheck.message });
    }

    appointment.appointmentDate = date;
    appointment.timeSlot = timeSlot;
    if (reason !== undefined) appointment.reason = reason;
    if (notes !== undefined) appointment.notes = notes;
    if (appointmentType !== undefined) appointment.appointmentType = appointmentType;
    if (durationMinutes !== undefined) appointment.durationMinutes = Number(durationMinutes);
    if (appointment.status === 'pending') appointment.status = 'scheduled';
    await appointment.save();

    try {
      await rescheduleAppointmentReminders(appointment);
      appointment.reminderScheduled = true;
      await appointment.save();
    } catch (err) {
      console.warn('Reminder reschedule failed:', err.message);
    }

    if (appointment.patientId) {
      await recordPatientEvent({
        clinicId: appointment.clinicId,
        doctorId: appointment.doctor,
        patientId: appointment.patientId,
        type: 'appointment_rescheduled',
        title: 'Appointment rescheduled',
        detail: `${timeSlot}`,
        appointmentId: appointment._id,
      });
    }

    await notifyDoctor({
      doctorId: appointment.doctor,
      clinicId: appointment.clinicId,
      type: 'appointment_rescheduled',
      title: 'Appointment rescheduled',
      body: timeSlot,
      link: `/doctor/appointments/${appointment._id}`,
      metadata: { appointmentId: appointment._id },
    });

    await appointment.populate(APPT_POPULATE);
    res.json({ success: true, message: 'Appointment rescheduled.', appointment });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'This time slot is already booked.' });
    }
    if (isCastError(error)) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDoctorDashboardStats = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Doctors only.' });
    }

    const doctorId = req.user._id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [todayAppts, allAppts, totalPatients, newPatients, upcoming] = await Promise.all([
      Appointment.find({
        doctor: doctorId,
        appointmentDate: { $gte: todayStart, $lte: todayEnd },
      }).populate(APPT_POPULATE),
      Appointment.find({ doctor: doctorId }).select('status patientId appointmentDate'),
      Patient.countDocuments({ doctorId, isActive: true }),
      Patient.countDocuments({ doctorId, isActive: true, createdAt: { $gte: weekAgo } }),
      Appointment.find({
        doctor: doctorId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        appointmentDate: { $gte: todayStart },
      })
        .sort({ appointmentDate: 1, timeSlot: 1 })
        .limit(5)
        .populate(APPT_POPULATE),
    ]);

    const countByStatus = (list, status) =>
      list.filter((a) => normalizeStatus(a.status) === status).length;

    const patientVisitCounts = {};
    for (const a of allAppts) {
      if (!a.patientId) continue;
      const key = String(a.patientId);
      patientVisitCounts[key] = (patientVisitCounts[key] || 0) + 1;
    }
    const returningPatients = Object.values(patientVisitCounts).filter((c) => c > 1).length;

    const recentPatients = await Patient.find({ doctorId, isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name patientCode phone createdAt gender age');

    res.json({
      success: true,
      stats: {
        today: {
          total: todayAppts.length,
          scheduled: countByStatus(todayAppts, 'scheduled') + countByStatus(todayAppts, 'confirmed'),
          completed: countByStatus(todayAppts, 'completed'),
          cancelled: countByStatus(todayAppts, 'cancelled'),
          noShow: countByStatus(todayAppts, 'no_show'),
          appointments: todayAppts.sort((a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot))),
        },
        patients: {
          total: totalPatients,
          newThisWeek: newPatients,
          returning: returningPatients,
          recent: recentPatients,
        },
        appointments: {
          upcoming: allAppts.filter((a) =>
            ACTIVE_APPOINTMENT_STATUSES.includes(normalizeStatus(a.status))
          ).length,
          completed: countByStatus(allAppts, 'completed'),
          cancelled: countByStatus(allAppts, 'cancelled'),
          noShow: countByStatus(allAppts, 'no_show'),
          next: upcoming,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getWhatsAppLink = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('patientId', 'name phone')
      .populate('patient', 'name phone')
      .populate('doctor', 'name specialization phone');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    const patientLike = appointment.patientId || appointment.patient;
    if (!patientLike || !appointment.doctor) {
      return res.status(400).json({
        success: false,
        message: 'Cannot generate WhatsApp link — missing patient or doctor data.',
      });
    }

    if (!assertCanManageAppointment(req, appointment)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const whatsappUrl = buildWhatsAppUrl(appointment, patientLike, appointment.doctor, 'doctor');
    if (!whatsappUrl) {
      return res.status(400).json({
        success: false,
        message: 'Patient has no phone number for WhatsApp.',
      });
    }
    res.json({ success: true, whatsappUrl });
  } catch (error) {
    if (isCastError(error)) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};
