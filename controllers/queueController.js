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

const POPULATE = [
  { path: 'patientId', select: 'name patientCode phone' },
  { path: 'doctorId', select: 'name specialization' },
  { path: 'appointmentId', select: 'timeSlot appointmentType status' },
];

export const listQueue = asyncHandler(async (req, res) => {
  if (!req.branchId && req.user.role === 'doctor') {
    return res.status(400).json({
      success: false,
      message: 'Select a specific branch to view the queue (not All branches).',
    });
  }
  const date = startOfDay(req.query.date ? new Date(req.query.date) : new Date());
  const end = new Date(date);
  end.setDate(end.getDate() + 1);
  const dayFilter = {
    ...tenantFilter(req.user, req.branchId),
    queueDate: { $gte: date, $lt: end },
  };
  if (req.query.doctorId) dayFilter.doctorId = req.query.doctorId;
  else if (req.query.mine === '1') dayFilter.doctorId = req.user._id;

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
  const { patientId, appointmentId, doctorId } = req.body;
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

  const date = startOfDay();
  const existing = await QueueTicket.findOne({
    clinicId: patient.clinicId,
    branchId: req.branchId,
    patientId: patient._id,
    queueDate: date,
    status: { $in: ['waiting', 'called', 'in_consultation'] },
  });
  if (existing) {
    await existing.populate(POPULATE);
    return res.json({ success: true, ticket: existing, alreadyCheckedIn: true });
  }

  const branch = await Branch.findById(req.branchId);
  const seq = await nextSequence(`queue:${req.branchId}:${date.toISOString().slice(0, 10)}`);
  const prefix = branch?.tokenPrefix || '';
  let ticket;
  try {
    ticket = await QueueTicket.create({
      clinicId: patient.clinicId,
      branchId: req.branchId,
      doctorId: doctorId || patient.doctorId,
      patientId: patient._id,
      appointmentId: appointmentId || null,
      tokenNumber: seq,
      tokenLabel: `${prefix}${seq}`,
      roomLabel: branch?.roomLabel || '',
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
        queueDate: date,
        status: { $in: ['waiting', 'called', 'in_consultation'] },
      });
      if (raced) {
        await raced.populate(POPULATE);
        return res.json({ success: true, ticket: raced, alreadyCheckedIn: true });
      }
    }
    throw err;
  }

  if (appointmentId) {
    await Appointment.findByIdAndUpdate(appointmentId, { status: 'confirmed' }).catch(() => {});
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
  const allowed = ['waiting', 'called', 'in_consultation', 'completed', 'cancelled', 'no_show'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid queue status.' });
  }
  ticket.status = status;
  if (status === 'called') ticket.calledAt = new Date();
  if (status === 'in_consultation') ticket.startedAt = new Date();
  if (status === 'completed' || status === 'cancelled' || status === 'no_show') ticket.completedAt = new Date();
  await ticket.save();
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
  const date = startOfDay();
  const filter = {
    ...tenantFilter(req.user, req.branchId),
    queueDate: date,
    status: 'waiting',
  };
  if (req.user.role === 'doctor') filter.doctorId = req.user._id;
  else if (req.body.doctorId) filter.doctorId = req.body.doctorId;

  await QueueTicket.updateMany(
    {
      ...tenantFilter(req.user, req.branchId),
      queueDate: date,
      status: 'called',
      ...(filter.doctorId ? { doctorId: filter.doctorId } : {}),
    },
    { $set: { status: 'waiting' } }
  );

  // Atomic claim — prevents two counters from calling the same waiting ticket.
  const next = await QueueTicket.findOneAndUpdate(
    filter,
    { $set: { status: 'called', calledAt: new Date() } },
    { sort: { tokenNumber: 1 }, new: true }
  );
  if (!next) return res.status(404).json({ success: false, message: 'No patients waiting.' });
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
  const date = startOfDay();
  const filter = { ...tenantFilter(req.user, req.branchId), queueDate: date };
  const tickets = await QueueTicket.find(filter).sort({ tokenNumber: 1 }).select(
    'tokenLabel tokenNumber status roomLabel doctorId calledAt'
  );
  const nowServing = tickets.find((t) => ['called', 'in_consultation'].includes(t.status)) || null;
  const waiting = tickets.filter((t) => t.status === 'waiting').slice(0, 8);
  const branch = req.branchId ? await Branch.findById(req.branchId).select('name displayTitle roomLabel tokenPrefix') : null;
  res.json({
    success: true,
    display: {
      title: branch?.displayTitle || branch?.name || 'Now serving',
      roomLabel: nowServing?.roomLabel || branch?.roomLabel || '',
      nowServing: nowServing
        ? { tokenLabel: nowServing.tokenLabel, tokenNumber: nowServing.tokenNumber, roomLabel: nowServing.roomLabel }
        : null,
      waiting: waiting.map((t) => ({ tokenLabel: t.tokenLabel, tokenNumber: t.tokenNumber })),
    },
  });
});
