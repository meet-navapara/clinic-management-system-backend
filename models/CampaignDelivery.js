import mongoose from 'mongoose';

const campaignDeliverySchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    channel: { type: String, enum: ['whatsapp', 'email', 'sms'], required: true },
    recipientPhone: { type: String, default: '' },
    recipientEmail: { type: String, default: '' },
    recipientName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'opted_out'],
      default: 'queued',
      index: true,
    },
    queuedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
    provider: { type: String, default: '' },
    providerMessageId: { type: String, default: '', index: true },
    renderedMessage: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

campaignDeliverySchema.index({ campaignId: 1, patientId: 1 }, { unique: true });
campaignDeliverySchema.index({ clinicId: 1, campaignId: 1, status: 1 });

const CampaignDelivery = mongoose.model('CampaignDelivery', campaignDeliverySchema);
export default CampaignDelivery;
