import mongoose from 'mongoose';

export const PRINT_DOC_TYPES = [
  'invoice',
  'receipt',
  'prescription',
  'consultation',
  'consent',
  'appointment_slip',
  'queue_token',
];

const printSettingsSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, unique: true },
    logo: { type: String, default: '' },
    clinicName: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    website: { type: String, default: '', trim: true },
    registrationNumber: { type: String, default: '', trim: true },
    gstNumber: { type: String, default: '', trim: true },
    taxLabel: { type: String, default: 'GST', trim: true },
    headerText: { type: String, default: '', trim: true },
    footerText: { type: String, default: 'Get well soon.', trim: true },
    terms: { type: String, default: '', trim: true },
    showSignature: { type: Boolean, default: true },
    signatureLabel: { type: String, default: 'Doctor signature', trim: true },
    paperSize: { type: String, enum: ['A4', 'A5', 'receipt'], default: 'A4' },
    currency: { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '₹' },
  },
  { timestamps: true }
);

const PrintSettings = mongoose.model('PrintSettings', printSettingsSchema);
export default PrintSettings;
