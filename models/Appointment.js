import mongoose from 'mongoose';

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  /** Legacy — normalized to scheduled in app logic */
  'pending',
];

export const ACTIVE_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'pending'];

/** Statuses that occupy a time slot (cancelled / no_show free it). */
export const SLOT_BLOCKING_STATUSES = [
  'scheduled',
  'confirmed',
  'pending',
  'completed',
];

const appointmentSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      default: null,
      index: true,
    },
    /** Legacy self-registered User patient */
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    appointmentDate: {
      type: Date,
      required: [true, 'Appointment date is required'],
      index: true,
    },
    timeSlot: {
      type: String,
      required: [true, 'Time slot is required'],
    },
    durationMinutes: {
      type: Number,
      default: 30,
      min: 5,
      max: 240,
    },
    appointmentType: {
      type: String,
      default: 'Consultation',
      trim: true,
    },
    reason: {
      type: String,
      required: [true, 'Reason for visit is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      default: 'scheduled',
      index: true,
    },
    notes: {
      type: String,
      default: '',
    },
    reminderScheduled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

appointmentSchema.pre('validate', function (next) {
  if (!this.patientId && !this.patient) {
    this.invalidate('patientId', 'Patient is required');
  }
  next();
});

appointmentSchema.index(
  { doctor: 1, appointmentDate: 1, timeSlot: 1 },
  {
    unique: true,
    // Only active bookings block a slot — completed/cancelled/no_show free it up.
    partialFilterExpression: {
      status: { $in: ['pending', 'scheduled', 'confirmed'] },
    },
  }
);
appointmentSchema.index({ clinicId: 1, branchId: 1, appointmentDate: 1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);
export default Appointment;
