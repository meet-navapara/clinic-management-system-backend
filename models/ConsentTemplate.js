import mongoose from 'mongoose';

const consentTemplateSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['general', 'procedure', 'therapy', 'privacy', 'treatment', 'other'],
      default: 'general',
    },
    body: { type: String, required: true, trim: true },
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

consentTemplateSchema.index({ clinicId: 1, name: 1 });

const ConsentTemplate = mongoose.model('ConsentTemplate', consentTemplateSchema);
export default ConsentTemplate;
