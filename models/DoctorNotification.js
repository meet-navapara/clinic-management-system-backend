import mongoose from 'mongoose';

/**
 * In-app notifications for doctors (separate from patient reminder delivery logs).
 */
export const DOCTOR_NOTIFICATION_TYPES = [
  'patient_added',
  'appointment_scheduled',
  'appointment_rescheduled',
  'appointment_cancelled',
  'appointment_completed',
  'appointment_no_show',
  'reminder_sent',
  'reminder_failed',
  'upcoming_appointment',
  'account_approved',
  'account_rejected',
  'account_suspended',
  'system',
];

const doctorNotificationSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
    },
    type: {
      type: String,
      enum: DOCTOR_NOTIFICATION_TYPES,
      required: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '', trim: true },
    link: { type: String, default: '' },
    readAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

doctorNotificationSchema.index({ doctorId: 1, createdAt: -1 });
doctorNotificationSchema.index({ doctorId: 1, readAt: 1 });

const DoctorNotification = mongoose.model('DoctorNotification', doctorNotificationSchema);
export default DoctorNotification;
