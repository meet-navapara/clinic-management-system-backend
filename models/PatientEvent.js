import mongoose from 'mongoose';

export const PATIENT_EVENT_TYPES = [
  'patient_created',
  'patient_updated',
  'appointment_scheduled',
  'appointment_confirmed',
  'appointment_completed',
  'appointment_cancelled',
  'appointment_no_show',
  'appointment_rescheduled',
  'note_added',
  'reminder_sent',
  'reminder_failed',
];

/**
 * Append-only timeline for a patient chart.
 */
const patientEventSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
      index: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: PATIENT_EVENT_TYPES,
      required: true,
    },
    title: { type: String, required: true, trim: true },
    detail: { type: String, default: '', trim: true },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

patientEventSchema.index({ patientId: 1, createdAt: -1 });

const PatientEvent = mongoose.model('PatientEvent', patientEventSchema);
export default PatientEvent;
