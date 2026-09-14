import mongoose from 'mongoose';

export const TEMPLATE_TYPES = [
  'consultation',
  'diagnosis',
  'treatment',
  'prescription_instructions',
  'followup_instructions',
];

const clinicalTemplateSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    ownerType: { type: String, enum: ['doctor', 'clinic'], default: 'doctor', index: true },
    type: { type: String, enum: TEMPLATE_TYPES, default: 'consultation', index: true },
    name: { type: String, required: true, trim: true },
    fields: {
      chiefComplaint: { type: String, default: '' },
      symptoms: { type: String, default: '' },
      observation: { type: String, default: '' },
      diagnosis: { type: String, default: '' },
      treatment: { type: String, default: '' },
      advice: { type: String, default: '' },
      followUp: { type: String, default: '' },
      instructions: { type: String, default: '' },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

clinicalTemplateSchema.index({ clinicId: 1, doctorId: 1, type: 1 });

const ClinicalTemplate = mongoose.model('ClinicalTemplate', clinicalTemplateSchema);
export default ClinicalTemplate;
