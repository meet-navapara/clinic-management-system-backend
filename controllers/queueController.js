import QueueTicket from '../models/QueueTicket.js';
import Branch from '../models/Branch.js';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';
import { nextSequence } from '../models/Counter.js';
import { asyncHandler } from '../middleware/access.js';
import { tenantFilter, assertSameClinic, assertBranchAccess } from '../utils/branchScope.js';
import { parsePagination, paginated } from '../utils/pagination.js';
import { writeAudit, AUDIT } from '../utils/audit.js';

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const dayBounds = (d = new Date()) => {
  const start = startOfDay(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const localDateKey = (d = new Date()) => {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Valid queue status transitions. */
const STATUS_TRANSITIONS = {
  waiting: ['called', 'in_consultation', 'cancelled', 'no_show'],
  called: ['waiting', 'in_consultation', 'cancelled', 'no_show'],
  in_consultation: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

const POPULATE = [
  { path: 'patientId', select: 'name patientCode phone' },
  { path: 'doctorId', select: 'name specialization' },
  { path: 'appointmentId', select: 'timeSlot appointmentType status' },
];

const dayFilterBase = (req, dateInput) => {
  const { start, end } = dayBounds(dateInput ? new Date(dateInput) : new Date());
  return {
    ...tenantFilter(req.user, req.branchId),
    queueDate: { $gte: start, $lt: end },
  };
};

/** Put other "called" tickets for the same doctor/room lane back to waiting. */
const releaseOtherCalled = async (ticket) => {
  if (!ticket) return;
  await QueueTicket.updateMany(
    {
      clinicId: ticket.clinicId,
      branchId: ticket.branchId,
      queueDate: {
        $gte: startOfDay(ticket.queueDate),
        $lt: (() => {
          const e = startOfDay(ticket.queueDate);
          e.setDate(e.getDate() + 1);
          return e;
        })(),
      },
      status: 'called',
      _id: { $ne: ticket._id },
      doctorId: ticket.doctorId || null,
    },
    { $set: { status: 'waiting' } }
  );
};

export const listQueue = asyncHandler(async (req, res) => {
  if (!req.branchId && req.user.role === 'doctor') {
    return res.status(400).json({
      success: false,
      message: 'Select a specific branch to view the queue (not All branches).',
    });
  }
  const dayFilter = dayFilterBase(req, req.query.date);
  if (req.query.doctorId) dayFilter.doctorId = req.query.doctorId;
  else if (req.query.mine === '1') {
    dayFilter.$or = [{ doctorId: req.user._id }, { doctorId: null }];
  }

  const filter = { ...dayFilter };
  if (req.query.status) filter.status = req.query.status;
  else filter.status = { $nin: ['cancelled'] };

  const { page, limit, skip } = parsePagination(req.query, { page: 1, limit: 20, max: 100 });

  const [tickets, total, current, nextWaiting, waitingCount] = await Promise.all([
    QueueTicket.find(filter).sort({ tokenNumber: 1 }).skip(skip).limit(limit).populate(POPULATE),
    QueueTicket.countDocuments(filter),
    QueueTicket.findOne({ ...dayFilter, status: { $in: ['called', 'in_consultation'] } })
      .sort({ tokenNumber: 1 })
      .populate(POPULATE),
    QueueTicket.findOne({ ...dayFilter, status: 'waiting' }).sort({ tokenNumber: 1 }).populate(POPULATE),
    QueueTicket.countDocuments({ ...dayFilter, status: 'waiting' }),
  ]);

  res.json({
    success: true,
    ...paginated({ items: tickets, total, page, limit }),
    tickets,
    current,
    next: nextWaiting,
    waitingCount,
  });
});

export const checkIn = asyncHandler(async (req, res) => {
  const { patientId, appointmentId, doctorId, roomLabel } = req.body;
  if (!req.branchId) {
    return res.status(400).json({ success: false, message: 'Select a branch to check in patients.' });
  }
  const patient = await Patient.findById(patientId);
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });
  assertSameClinic(req.user, patient.clinicId);
  assertBranchAccess(req.user, patient.branchId);
  if (patient.branchId && String(patient.branchId) !== String(req.branchId)) {
    return res.status(403).json({
      success: false,
      message: 'This patient belongs to another branch.',
    });
  }

  const { start, end } = dayBounds();
  const existing = await QueueTicket.findOne({
    clinicId: patient.clinicId,
    branchId: req.branchId,
    patientId: patient._id,
    queueDate: { $gte: start, $lt: end },
    status: { $in: ['waiting', 'called', 'in_consultation'] },
  });
  if (existing) {
    await existing.populate(POPULATE);
    return res.json({ success: true, ticket: existing, alreadyCheckedIn: true });
  }

  let resolvedDoctorId = doctorId || patient.doctorId || null;
  let resolvedAppointmentId = appointmentId || null;

  if (appointmentId) {
    const appt = await Appointment.findById(appointmentId);
    if (!appt) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }
    assertSameClinic(req.user, appt.clinicId);
    if (String(appt.patientId) !== String(patient._id)) {
      return res.status(400).json({ success: false, message: 'Appointment does not belong to this patient.' });
    }
    if (appt.branchId && String(appt.branchId) !== String(req.branchId)) {
      return res.status(403).json({ success: false, message: 'Appointment belongs to another branch.' });
    }
    resolvedDoctorId = doctorId || appt.doctor || patient.doctorId || null;
    resolvedAppointmentId = appt._id;
  }

  if (req.user.role === 'doctor' && !resolvedDoctorId) {
    resolvedDoctorId = req.user._id;
  }

  const branch = await Branch.findById(req.branchId);
  const rooms = Array.isArray(branch?.rooms) ? branch.rooms.map(String) : [];
  let room = roomLabel || branch?.roomLabel || '';
  if (roomLabel && rooms.length && !rooms.includes(String(roomLabel))) {
    return res.status(400).json({ success: false, message: 'Selected room is not configured for this branch.' });
  }
  if (!room && rooms.length) room = rooms[0];

  const date = start;
  const seq = await nextSequence(`queue:${req.branchId}:${localDateKey(date)}`);
  const prefix = branch?.tokenPrefix || '';
  let ticket;
  try {
    ticket = await QueueTicket.create({
      clinicId: patient.clinicId,
      branchId: req.branchId,
      doctorId: resolvedDoctorId,
      patientId: patient._id,
      appointmentId: resolvedAppointmentId,
      tokenNumber: seq,
      tokenLabel: `${prefix}${seq}`,
      roomLabel: room,
      status: 'waiting',
      queueDate: date,
      createdBy: req.user._id,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const raced = await QueueTicket.findOne({
        clinicId: patient.clinicId,
        branchId: req.branchId,
        patientId: patient._id,
        queueDate: { $gte: start, $lt: end },
        status: { $in: ['waiting', 'called', 'in_consultation'] },
      });
      if (raced) {
        await raced.populate(POPULATE);
        return res.json({ success: true, ticket: raced, alreadyCheckedIn: true });
      }
    }
    throw err;
  }

  if (resolvedAppointmentId) {
    await Appointment.findByIdAndUpdate(resolvedAppointmentId, { status: 'confirmed' }).catch(() => {});
  }

  await writeAudit({
    clinicId: ticket.clinicId,
    branchId: ticket.branchId,
    actorId: req.user._id,
    action: AUDIT.QUEUE_CHECKIN,
    entityType: 'QueueTicket',
    entityId: ticket._id,
    detail: `Token ${ticket.tokenLabel}`,
  });

  await ticket.populate(POPULATE);
  res.status(201).json({ success: true, ticket });
});

export const updateTicketStatus = asyncHandler(async (req, res) => {
  const ticket = await QueueTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });
  assertSameClinic(req.user, ticket.clinicId);
  assertBranchAccess(req.user, ticket.branchId);
  const status = req.body.status;
  const allowed = STATUS_TRANSITIONS[ticket.status] || [];
  if (!allowed.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Cannot change queue ticket from ${ticket.status} to ${status}.`,
    });
  }
  ticket.status = status;
  if (status === 'called') ticket.calledAt = new Date();
  if (status === 'in_consultation') ticket.startedAt = new Date();
  if (status === 'completed' || status === 'cancelled' || status === 'no_show') {
    ticket.completedAt = new Date();
  }
  await ticket.save();

  if (status === 'called') {
    await releaseOtherCalled(ticket);
  }

  // Keep linked appointment in sync for terminal queue outcomes.
  if (ticket.appointmentId && ['completed', 'cancelled', 'no_show'].includes(status)) {
    const apptStatus = status === 'completed' ? 'completed' : status;
    await Appointment.findByIdAndUpdate(ticket.appointmentId, { status: apptStatus }).catch(() => {});
  }

  await ticket.populate(POPULATE);
  res.json({ success: true, ticket });
});

export const callNext = asyncHandler(async (req, res) => {
  if (!req.branchId) {
    return res.status(400).json({
      success: false,
      message: 'Select a specific branch before calling the next patient.',
    });
  }
  const { start, end } = dayBounds();
  const base = {
    ...tenantFilter(req.user, req.branchId),
    queueDate: { $gte: start, $lt: end },
    status: 'waiting',
  };

  let doctorScope = null;
  if (req.user.role === 'doctor') doctorScope = req.user._id;
  else if (req.body.doctorId) doctorScope = req.body.doctorId;

  const filter = { ...base };
  if (doctorScope) {
    // Include unassigned walk-ins so doctors can claim them.
    filter.$or = [{ doctorId: doctorScope }, { doctorId: null }];
  }

  const setFields = { status: 'called', calledAt: new Date() };
  if (doctorScope) setFields.doctorId = doctorScope;

  const next = await QueueTicket.findOneAndUpdate(filter, { $set: setFields }, {
    sort: { tokenNumber: 1 },
    new: true,
  });
  if (!next) return res.status(404).json({ success: false, message: 'No patients waiting.' });

  await releaseOtherCalled(next);
  await next.populate(POPULATE);
  res.json({ success: true, ticket: next });
});

export const displayQueue = asyncHandler(async (req, res) => {
  if (!req.branchId) {
    return res.status(400).json({
      success: false,
      message: 'Select a specific branch for the queue display.',
    });
  }
  const filter = dayFilterBase(req);
  const tickets = await QueueTicket.find(filter).sort({ tokenNumber: 1 }).select(
    'tokenLabel tokenNumber status roomLabel doctorId calledAt'
  );
  const nowServing = tickets.find((t) => ['called', 'in_consultation'].includes(t.status)) || null;
  const waiting = tickets.filter((t) => t.status === 'waiting').slice(0, 8);
  const branch = req.branchId
    ? await Branch.findById(req.branchId).select('name displayTitle roomLabel tokenPrefix')
    : null;
  res.json({
    success: true,
    display: {
      title: branch?.displayTitle || branch?.name || 'Now serving',
      roomLabel: nowServing?.roomLabel || branch?.roomLabel || '',
      nowServing: nowServing
        ? {
            tokenLabel: nowServing.tokenLabel,
            tokenNumber: nowServing.tokenNumber,
            roomLabel: nowServing.roomLabel,
          }
        : null,
      waiting: waiting.map((t) => ({ tokenLabel: t.tokenLabel, tokenNumber: t.tokenNumber })),
    },
  });
});
