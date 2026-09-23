import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import Patient from '../models/Patient.js';
import NotificationLog from '../models/NotificationLog.js';
import { isSameClinic } from '../middleware/auth.js';
import { hasPermission, P } from '../utils/permissions.js';
import { tenantFilter, assertBranchAccess, resolveWriteBranchId, canAccessBranch } from '../utils/branchScope.js';
import { parsePagination, paginated } from '../utils/pagination.js';
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
import { ACTIVE_APPOINTMENT_STATUSES, SLOT_BLOCKING_STATUSES } from '../models/Appointment.js';
import {
  generateTimeSlots,
  windowFromLegacySlots,
  timeToMinutes,
  isValidHhMm,
  isSlotInPast,
} from '../utils/timeSlots.js';
import { getCommsConfigStatus, sendViaChannel } from '../utils/comms/providers.js';

const isCastError = (error) => error?.name === 'CastError' || error?.kind === 'ObjectId';

const APPT_POPULATE = [
  {
    path: 'patientId',
    select:
      'name firstName lastName preferredName patientCode email phone age gender address clinical notes medicalHistory emergencyContact profilePhoto',
  },
  { path: 'patient', select: 'name email phone profilePhoto clinicId' },
  {
    path: 'doctor',
    select: 'name specialization consultationFee phone profilePhoto clinicId availableSlots availableDays practiceSettings',
  },
];

const assertSlotAvailable = async ({
  doctor,
  doctorId,
  date,
  timeSlot,
  durationMinutes = 30,
  excludeId = null,
}) => {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const workingDays =
    doctor.availableDays?.length > 0
      ? doctor.availableDays
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  if (!workingDays.includes(dayName)) {
    return { ok: false, status: 400, message: `Doctor is not available on ${dayName}.` };
  }

  if (!isValidHhMm(timeSlot)) {
    return { ok: false, status: 400, message: 'Invalid time slot.' };
  }

  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (isSlotInPast(dateKey, timeSlot)) {
    return {
      ok: false,
      status: 400,
      message: 'That time has already passed. Please choose a later slot.',
    };
  }

  const duration = Math.max(5, Math.min(240, Number(durationMinutes) || 30));
  const settings = doctor.practiceSettings || {};
  const legacyWindow = windowFromLegacySlots(doctor.availableSlots);
  const dayStart = settings.dayStart || legacyWindow.dayStart;
  const dayEnd = settings.dayEnd || legacyWindow.dayEnd;
  const allowed = generateTimeSlots({
    dayStart,
    dayEnd,
    durationMinutes: duration,
    breakStart: settings.breakStart || '13:00',
    breakEnd: settings.breakEnd || '14:00',
  });

  if (!allowed.includes(timeSlot)) {
    return {
      ok: false,
      status: 400,
      message: `Selected time is outside available hours for a ${duration}-minute visit.`,
    };
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const existingFilter = {
    doctor: doctorId,
    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: SLOT_BLOCKING_STATUSES },
  };
  if (excludeId) existingFilter._id = { $ne: excludeId };

  const existing = await Appointment.find(existingFilter).select('timeSlot durationMinutes');
  const start = timeToMinutes(timeSlot);
  const end = start + duration;
  const clash = existing.some((a) => {
    const bStart = timeToMinutes(a.timeSlot);
    if (bStart == null) return a.timeSlot === timeSlot;
    const bEnd = bStart + (Number(a.durationMinutes) || duration);
    return start < bEnd && end > bStart;
  });

  if (clash) {
    return {
      ok: false,
      status: 400,
      message: 'This time overlaps another appointment. Please choose another slot.',
    };
  }

  return { ok: true };
};

const assertCanManageAppointment = (req, appointment) => {
  if (!isSameClinic(req.user, appointment.clinicId)) return false;
  if (!canAccessBranch(req.user, appointment.branchId)) return false;
  if (req.user.role === 'doctor') return true;
  return hasPermission(req.user, P.APPOINTMENTS_MANAGE);
};

export const createAppointment = async (req, res) => {
  try {
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
    if (!isDoctor && !hasPermission(req.user, P.APPOINTMENTS_MANAGE)) {
      return res.status(403).json({
        success: false,
        message: 'Appointments are created by clinic staff.',
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
    if (!isSameClinic(req.user, patientRecord.clinicId)) {
      return res.status(403).json({ success: false, message: 'Patient belongs to another clinic.' });
    }
    try {
      assertBranchAccess(req.user, patientRecord.branchId);
    } catch (err) {
      return res.status(err.status || 403).json({ success: false, message: err.message });
    }

    let doctor;
    if (isDoctor) {
      doctor = req.user;
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
      if (!isSameClinic(req.user, doctor.clinicId)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot book with a doctor outside your clinic.',
        });
      }
    }

    const date = new Date(appointmentDate);
    const duration =
      durationMinutes ||
      doctor.practiceSettings?.defaultDurationMinutes ||
      30;
    const slotCheck = await assertSlotAvailable({
      doctor,
      doctorId: doctor._id,
      date,
      timeSlot,
      durationMinutes: duration,
    });
    if (!slotCheck.ok) {
      return res.status(slotCheck.status).json({ success: false, message: slotCheck.message });
    }

    const initialStatus =
      requestedStatus && ['scheduled', 'confirmed'].includes(requestedStatus)
        ? requestedStatus
        : 'scheduled';

    let branchId;
    try {
      branchId = await resolveWriteBranchId(
        req.user,
        patientRecord.branchId || req.branchId
      );
    } catch (err) {
      return res.status(err.status || 400).json({ success: false, message: err.message });
    }

    const appointment = await Appointment.create({
      clinicId: doctor.clinicId || patientRecord.clinicId || null,
      branchId,
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
      actorId: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully!',
      appointment,
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
    if (req.user.role !== 'doctor' && !hasPermission(req.user, P.APPOINTMENTS_VIEW)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to list appointments.',
      });
    }

    const filter = { ...tenantFilter(req.user, req.branchId) };
    if (req.user.role === 'doctor' && req.query.mine === '1') {
      filter.doctor = req.user._id;
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

    const hasRange = Boolean(from || to || date);
    const { page, limit, skip } = parsePagination(req.query, {
      page: 1,
      limit: hasRange ? 500 : 20,
      max: hasRange ? 1000 : 100,
    });

    const [appointments, total] = await Promise.all([
      Appointment.find(filter)
        .populate(APPT_POPULATE)
        .sort({ appointmentDate: 1, timeSlot: 1 })
        .skip(skip)
        .limit(limit),
      Appointment.countDocuments(filter),
    ]);

    res.json({
      success: true,
      ...paginated({ items: appointments, total, page, limit }),
      count: appointments.length,
      appointments,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
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
    if (req.user.role !== 'doctor' && !hasPermission(req.user, P.PATIENTS_VIEW)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Enter at least 2 characters of name, phone, or patient ID.',
      });
    }

    const filter = { isActive: true, ...tenantFilter(req.user, req.branchId) };
    if (req.query.mine === '1') filter.doctorId = req.user._id;

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

    if (nextStatus === 'cancelled' || nextStatus === 'no_show' || nextStatus === 'completed') {
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

    if (['cancelled', 'completed', 'no_show'].includes(nextStatus)) {
      const type =
        nextStatus === 'cancelled'
          ? 'appointment_cancelled'
          : nextStatus === 'no_show'
            ? 'appointment_no_show'
            : 'appointment_completed';
      let patientName = 'Patient';
      if (appointment.patientId) {
        const p = await Patient.findById(appointment.patientId).select('name').lean();
        if (p?.name) patientName = p.name;
      }
      const slot = appointment.timeSlot ? ` · ${appointment.timeSlot}` : '';
      await notifyDoctor({
        doctorId: appointment.doctor,
        clinicId: appointment.clinicId,
        type,
        title: `Appointment ${nextStatus.replace(/_/g, ' ')}`,
        body: `${patientName}${slot}`,
        link: `/doctor/appointments/${appointment._id}`,
        metadata: { appointmentId: appointment._id },
        actorId: req.user._id,
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
    const duration =
      durationMinutes !== undefined
        ? Number(durationMinutes)
        : appointment.durationMinutes ||
          doctor.practiceSettings?.defaultDurationMinutes ||
          30;
    const slotCheck = await assertSlotAvailable({
      doctor,
      doctorId: doctor._id,
      date,
      timeSlot,
      durationMinutes: duration,
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
      actorId: req.user._id,
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
    const branchScope = tenantFilter(req.user, req.branchId);
    const periodRaw = String(req.query.period || 'today').toLowerCase();
    const period = ['today', 'week', 'month'].includes(periodRaw) ? periodRaw : 'today';

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    let rangeStart = dayStart;
    let rangeEnd = dayEnd;
    if (period === 'week') {
      // Monday-start week containing today
      const dow = dayStart.getDay(); // 0 Sun … 6 Sat
      const offsetToMon = dow === 0 ? -6 : 1 - dow;
      rangeStart = new Date(dayStart);
      rangeStart.setDate(dayStart.getDate() + offsetToMon);
      rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeStart.getDate() + 6);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (period === 'month') {
      rangeStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
      rangeEnd = new Date(dayStart.getFullYear(), dayStart.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const weekAgo = new Date(dayStart);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [periodAppts, allAppts, totalPatients, newPatients] = await Promise.all([
      Appointment.find({
        ...branchScope,
        doctor: doctorId,
        appointmentDate: { $gte: rangeStart, $lte: rangeEnd },
      }).populate(APPT_POPULATE),
      Appointment.find({ ...branchScope, doctor: doctorId }).select('status patientId appointmentDate'),
      Patient.countDocuments({ ...branchScope, doctorId, isActive: true }),
      Patient.countDocuments({ ...branchScope, doctorId, isActive: true, createdAt: { $gte: weekAgo } }),
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

    const patientsInPeriod = new Set(
      periodAppts.map((a) => (a.patientId?._id || a.patientId ? String(a.patientId._id || a.patientId) : '')).filter(Boolean)
    ).size;

    const recentPatients = await Patient.find({ ...branchScope, doctorId, isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name patientCode phone createdAt gender age');

    const Invoice = (await import('../models/Invoice.js')).default;
    const QueueTicket = (await import('../models/QueueTicket.js')).default;
    const Prescription = (await import('../models/Prescription.js')).default;

    const tomorrowStart = new Date(dayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const [ownRevenue, waitingQueue, rxCount, upcomingNext] = await Promise.all([
      Invoice.aggregate([
        { $match: { ...branchScope, doctorId, paymentStatus: { $ne: 'cancelled' } } },
        { $group: { _id: null, paid: { $sum: '$paidAmount' }, billed: { $sum: '$total' }, due: { $sum: '$dueAmount' } } },
      ]),
      QueueTicket.find({
        ...branchScope,
        doctorId,
        queueDate: { $gte: dayStart, $lt: tomorrowStart },
        status: { $in: ['waiting', 'called', 'in_consultation'] },
      })
        .sort({ tokenNumber: 1 })
        .limit(8)
        .populate('patientId', 'name patientCode')
        .populate('appointmentId', 'timeSlot appointmentType status'),
      Prescription.countDocuments({ ...branchScope, doctorId }),
      Appointment.find({
        ...branchScope,
        doctor: doctorId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        appointmentDate: { $gte: tomorrowStart },
      })
        .sort({ appointmentDate: 1, timeSlot: 1 })
        .limit(5)
        .populate(APPT_POPULATE),
    ]);

    const sortedPeriodAppts = [...periodAppts].sort((a, b) => {
      const da = new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime();
      if (da !== 0) return da;
      return String(a.timeSlot || '').localeCompare(String(b.timeSlot || ''));
    });

    const periodStats = {
      key: period,
      from: rangeStart.toISOString(),
      to: rangeEnd.toISOString(),
      total: sortedPeriodAppts.length,
      scheduled: countByStatus(sortedPeriodAppts, 'scheduled') + countByStatus(sortedPeriodAppts, 'confirmed'),
      completed: countByStatus(sortedPeriodAppts, 'completed'),
      cancelled: countByStatus(sortedPeriodAppts, 'cancelled'),
      noShow: countByStatus(sortedPeriodAppts, 'no_show'),
      patients: patientsInPeriod,
      appointments: sortedPeriodAppts,
    };

    res.json({
      success: true,
      stats: {
        period: periodStats,
        // Keep `today` shape for older clients — mirrors selected period
        today: {
          total: periodStats.total,
          scheduled: periodStats.scheduled,
          completed: periodStats.completed,
          cancelled: periodStats.cancelled,
          noShow: periodStats.noShow,
          appointments: periodStats.appointments,
        },
        patients: {
          total: totalPatients,
          inPeriod: patientsInPeriod,
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
          next: upcomingNext,
        },
        revenue: {
          paid: ownRevenue[0]?.paid || 0,
          billed: ownRevenue[0]?.billed || 0,
          due: ownRevenue[0]?.due || 0,
        },
        queue: waitingQueue,
        prescriptions: { total: rxCount },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendAppointmentWhatsApp = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('patientId', 'name phone')
      .populate('patient', 'name phone')
      .populate('doctor', 'name specialization phone')
      .populate('clinicId', 'name');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    const patientLike = appointment.patientId || appointment.patient;
    if (!patientLike || !appointment.doctor) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send WhatsApp — missing patient or doctor data.',
      });
    }

    if (!assertCanManageAppointment(req, appointment)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const phone = patientLike.phone;
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Patient has no phone number for WhatsApp.',
      });
    }

    if (!getCommsConfigStatus().whatsapp.configured) {
      return res.status(503).json({
        success: false,
        message:
          'WhatsApp provider not configured. Set MSG91_AUTH_KEY, MSG91_WHATSAPP_NUMBER, and MSG91_WHATSAPP_TEMPLATE_NAME.',
      });
    }

    const dateLabel = new Date(appointment.appointmentDate).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const doctorName = appointment.doctor?.name || 'Doctor';
    const clinicName = appointment.clinicId?.name || 'the clinic';
    const patientName = patientLike.name || 'Patient';
    const timeSlot = appointment.timeSlot || '';

    const result = await sendViaChannel('whatsapp', {
      toPhone: phone,
      bodyText: `Appointment reminder for ${patientName} on ${dateLabel} at ${timeSlot}`,
      templateKind: 'confirmation',
      context: {
        patientName,
        clinicName,
        doctorName,
        dateLabel,
        timeSlot,
      },
    });

    await NotificationLog.create({
      clinicId: appointment.clinicId?._id || appointment.clinicId,
      appointmentId: appointment._id,
      patientId: patientLike._id || patientLike.id,
      recipientPhone: phone,
      recipientName: patientName,
      notificationType: 'appointment_confirmation',
      message: `Manual WhatsApp notify · ${dateLabel} · ${timeSlot}`,
      channel: 'whatsapp',
      provider: result.provider || 'msg91',
      status: 'sent',
      sentAt: new Date(),
      scheduledAt: new Date(),
      metadata: {
        source: 'manual_notify',
        providerMessageId: result.providerMessageId || null,
      },
    }).catch(() => {});

    if (patientLike._id) {
      await recordPatientEvent({
        clinicId: appointment.clinicId?._id || appointment.clinicId,
        doctorId: appointment.doctor?._id || appointment.doctor,
        patientId: patientLike._id,
        type: 'reminder_sent',
        title: 'WhatsApp notification sent',
        detail: `Template via MSG91 · ${timeSlot}`,
        appointmentId: appointment._id,
      }).catch(() => {});
    }

    res.json({
      success: true,
      sent: true,
      provider: result.provider || 'msg91',
      message: 'WhatsApp template sent to the patient.',
    });
  } catch (error) {
    if (isCastError(error)) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to send WhatsApp.',
    });
  }
};

/** @deprecated Prefer POST sendAppointmentWhatsApp — kept for older clients. */
export const getWhatsAppLink = sendAppointmentWhatsApp;
