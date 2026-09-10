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

const appointmentSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
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
    partialFilterExpression: {
      status: { $in: ['pending', 'scheduled', 'confirmed', 'completed'] },
    },
  }
);

const Appointment = mongoose.model('Appointment', appointmentSchema);
export default Appointment;
