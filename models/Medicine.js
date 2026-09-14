import mongoose from 'mongoose';

export const DOSAGE_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'cream',
  'oil',
  'powder',
  'drops',
  'injection',
  'ointment',
  'inhaler',
  'other',
];

const medicineSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    name: { type: String, required: true, trim: true },
    genericName: { type: String, default: '', trim: true, index: true },
    category: { type: String, default: '', trim: true },
    strength: { type: String, default: '', trim: true },
    /** Strength unit e.g. mg — separate from inventory packaging `unit` */
    strengthUnit: { type: String, default: '', trim: true },
    dosageForm: { type: String, enum: DOSAGE_FORMS, default: 'tablet' },
    unit: { type: String, default: 'strip', trim: true },
    manufacturer: { type: String, default: '', trim: true },
    sellingPrice: { type: Number, default: 0, min: 0 },
    purchasePrice: { type: Number, default: 0, min: 0 },
    minimumStockLevel: { type: Number, default: 10, min: 0 },
    hsnCode: { type: String, default: '', trim: true },
    taxRate: { type: Number, default: 0, min: 0 },
    defaultDosage: { type: String, default: '', trim: true },
    defaultFrequency: { type: String, default: '', trim: true },
    defaultDuration: { type: String, default: '', trim: true },
    dosageMorning: { type: String, default: '', trim: true },
    dosageNoon: { type: String, default: '', trim: true },
    dosageNight: { type: String, default: '', trim: true },
    beforeFood: { type: Boolean, default: false },
    afterFood: { type: Boolean, default: false },
    instructions: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

medicineSchema.index({ clinicId: 1, name: 1 });
medicineSchema.index({
  name: 'text',
  genericName: 'text',
  manufacturer: 'text',
});

const Medicine = mongoose.model('Medicine', medicineSchema);
export default Medicine;
