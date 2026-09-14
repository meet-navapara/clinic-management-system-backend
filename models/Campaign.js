import mongoose from 'mongoose';

export const CAMPAIGN_CHANNELS = ['whatsapp', 'sms', 'email'];
export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'];
export const AUDIENCE_TYPES = [
  'all',
  'new',
  'inactive',
  'followup',
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
    message: { type: String, required: true, trim: true },
    channel: { type: String, enum: CAMPAIGN_CHANNELS, default: 'whatsapp' },
    audienceType: { type: String, enum: AUDIENCE_TYPES, default: 'all' },
    audienceFilter: {
      doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
      tags: { type: [String], default: [] },
      patientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Patient' }],
      inactiveDays: { type: Number, default: 90 },
    },
    scheduledAt: { type: Date, default: null, index: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'draft', index: true },
    recipientCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    confirmedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

campaignSchema.index({ clinicId: 1, createdAt: -1 });

const Campaign = mongoose.model('Campaign', campaignSchema);
export default Campaign;
