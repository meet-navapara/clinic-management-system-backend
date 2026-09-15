import mongoose from 'mongoose';

export const QUEUE_STATUSES = [
  'waiting',
  'called',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
];

const queueTicketSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null, index: true },
    tokenNumber: { type: Number, required: true },
    tokenLabel: { type: String, required: true, trim: true },
    roomLabel: { type: String, default: '', trim: true },
    status: { type: String, enum: QUEUE_STATUSES, default: 'waiting', index: true },
    queueDate: { type: Date, required: true, index: true },
    checkedInAt: { type: Date, default: Date.now },
    calledAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

queueTicketSchema.index({ clinicId: 1, branchId: 1, queueDate: 1, tokenNumber: 1 }, { unique: true });
queueTicketSchema.index({ clinicId: 1, branchId: 1, doctorId: 1, status: 1 });
// One active check-in per patient per branch per day (race-safe with unique + catch duplicate).
queueTicketSchema.index(
  { clinicId: 1, branchId: 1, patientId: 1, queueDate: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['waiting', 'called', 'in_consultation'] } },
  }
);

const QueueTicket = mongoose.model('QueueTicket', queueTicketSchema);
export default QueueTicket;
