import mongoose from 'mongoose';

export const CAMPAIGN_CHANNELS = ['whatsapp', 'email', 'sms'];
export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'queued',
  'processing',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
];
export const CAMPAIGN_PURPOSES = ['marketing', 'transactional'];
export const CAMPAIGN_TYPES = [
  'follow_up',
  'appointment_reminder',
  'reactivation',
  'birthday',
  'seasonal',
  'new_service',
  'promotional',
  'general',
  'missed_appointment',
  'health_camp',
];
export const AUDIENCE_TYPES = [
  'all',
  'new',
  'inactive',
  'followup',
  'upcoming',
  'missed',
  'birthday',
  'doctor',
  'branch',
  'tags',
  'selected',
];

const campaignSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    campaignType: { type: String, enum: CAMPAIGN_TYPES, default: 'general' },
    purpose: { type: String, enum: CAMPAIGN_PURPOSES, default: 'marketing' },
    message: { type: String, required: true, trim: true },
    subject: { type: String, default: '', trim: true },
    channel: { type: String, enum: CAMPAIGN_CHANNELS, default: 'whatsapp' },
    audienceType: { type: String, enum: AUDIENCE_TYPES, default: 'all' },
    audienceFilter: {
      doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
      tags: { type: [String], default: [] },
      patientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Patient' }],
      inactiveDays: { type: Number, default: 90 },
      upcomingHours: { type: Number, default: 48 },
      gender: { type: String, default: '' },
      hasEmail: { type: Boolean, default: false },
      hasPhone: { type: Boolean, default: false },
    },
    scheduledAt: { type: Date, default: null, index: true },
    timezone: { type: String, default: 'Asia/Kolkata' },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'draft', index: true },
    recipientCount: { type: Number, default: 0 },
    eligibleCount: { type: Number, default: 0 },
    excludedCount: { type: Number, default: 0 },
    queuedCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    confirmedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

campaignSchema.index({ clinicId: 1, createdAt: -1 });
campaignSchema.index({ status: 1, scheduledAt: 1 });

const Campaign = mongoose.model('Campaign', campaignSchema);
export default Campaign;
