import mongoose from 'mongoose';

const campaignDeliverySchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    channel: { type: String, enum: ['whatsapp', 'sms', 'email'], required: true },
    recipientPhone: { type: String, default: '' },
    recipientEmail: { type: String, default: '' },
    recipientName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    sentAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
    provider: { type: String, default: 'internal' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

campaignDeliverySchema.index({ campaignId: 1, patientId: 1 }, { unique: true });
campaignDeliverySchema.index({ clinicId: 1, campaignId: 1, status: 1 });

const CampaignDelivery = mongoose.model('CampaignDelivery', campaignDeliverySchema);
export default CampaignDelivery;
