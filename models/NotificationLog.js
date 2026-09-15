import mongoose from 'mongoose';

/**
 * Tracks scheduled/sent reminders so the same message is not sent twice.
 */
const notificationLogSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
      index: true,
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      default: null,
    },
    recipientPhone: {
      type: String,
      default: '',
    },
    recipientName: {
      type: String,
      default: '',
    },
    notificationType: {
      type: String,
      enum: [
        'appointment_reminder',
        'appointment_confirmation',
        'appointment_cancellation',
        'followup_reminder',
        'campaign',
      ],
      required: true,
    },
    channel: {
      type: String,
      enum: ['whatsapp_link', 'whatsapp', 'sms', 'email', 'log'],
      default: 'log',
    },
    message: {
      type: String,
      default: '',
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['scheduled', 'sent', 'failed', 'cancelled', 'skipped'],
      default: 'scheduled',
      index: true,
    },
    provider: {
      type: String,
      default: 'internal',
    },
    error: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

notificationLogSchema.index(
  { appointmentId: 1, notificationType: 1, status: 1 },
  { name: 'appt_type_status' }
);

const NotificationLog = mongoose.model('NotificationLog', notificationLogSchema);
export default NotificationLog;
