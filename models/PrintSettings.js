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

/**
 * Per-clinic print / invoice branding template.
 * One document per clinicId — used by all printable docs for that clinic.
 */
const printSettingsSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      unique: true,
      index: true,
    },
    // Prefer Cloudinary HTTPS URLs; maxlength keeps room for legacy data URLs.
    logo: { type: String, default: '', maxlength: 600000 },
    clinicName: { type: String, default: '', trim: true, maxlength: 200 },
    address: { type: String, default: '', trim: true, maxlength: 500 },
    phone: { type: String, default: '', trim: true, maxlength: 80 },
    email: { type: String, default: '', trim: true, maxlength: 120 },
    website: { type: String, default: '', trim: true, maxlength: 200 },
    appointmentPhone: { type: String, default: '', trim: true, maxlength: 80 },
    registrationNumber: { type: String, default: '', trim: true, maxlength: 80 },
    gstNumber: { type: String, default: '', trim: true, maxlength: 40 },
    taxLabel: { type: String, default: 'GST', trim: true, maxlength: 40 },

    headerText: { type: String, default: '', trim: true, maxlength: 2000 },
    footerText: { type: String, default: 'Get well soon.', trim: true, maxlength: 2000 },
    headerHtml: { type: String, default: '', maxlength: 100000 },
    footerHtml: { type: String, default: '', maxlength: 100000 },
    leftContentHtml: { type: String, default: '', maxlength: 100000 },
    rightContentHtml: { type: String, default: '', maxlength: 100000 },
    terms: { type: String, default: '', trim: true, maxlength: 2000 },

    includeHeader: { type: Boolean, default: true },
    includeFooter: { type: Boolean, default: true },

    showLeftSignature: { type: Boolean, default: false },
    showRightSignature: { type: Boolean, default: true },
    leftSignatureText: { type: String, default: '', trim: true, maxlength: 500 },
    rightSignatureText: { type: String, default: '', trim: true, maxlength: 500 },
    signatureImage: { type: String, default: '', maxlength: 600000 },
    signatureLabel: { type: String, default: 'Doctor signature', trim: true, maxlength: 120 },
    showSignature: { type: Boolean, default: true },

    paperSize: {
      type: String,
      enum: ['A4', 'A5', 'Letter', 'receipt'],
      default: 'A4',
    },
    pageOrientation: {
      type: String,
      enum: ['portrait', 'landscape'],
      default: 'portrait',
    },
    marginTopIn: { type: Number, default: 0.5, min: 0, max: 3 },
    marginBottomIn: { type: Number, default: 0.5, min: 0, max: 3 },
    marginLeftIn: { type: Number, default: 0.5, min: 0, max: 3 },
    marginRightIn: { type: Number, default: 0.5, min: 0, max: 3 },

    headingFontSize: { type: Number, default: 14, min: 8, max: 28 },
    contentFontSize: { type: Number, default: 12, min: 8, max: 20 },
    subContentFontSize: { type: Number, default: 11, min: 8, max: 18 },

    showPoweredBy: { type: Boolean, default: false },
    coloredPrint: { type: Boolean, default: true },

    currency: { type: String, default: 'INR', trim: true, maxlength: 8 },
    currencySymbol: { type: String, default: '₹', trim: true, maxlength: 8 },
  },
  { timestamps: true }
);

const PrintSettings = mongoose.model('PrintSettings', printSettingsSchema);
export default PrintSettings;
