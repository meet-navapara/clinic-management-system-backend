import mongoose from 'mongoose';

const clinicSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Clinic name is required'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    email: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    logo: {
      type: String,
      default: '',
    },
    workingHours: {
      type: Map,
      of: String,
      default: {},
    },
    appointmentDuration: {
      type: Number,
      default: 60,
      min: 15,
    },
    reminderSettings: {
      appointmentHoursBefore: { type: Number, default: 24 },
      followUpDaysBefore: { type: Number, default: 2 },
    },
    whatsappNumber: {
      type: String,
      default: '',
      trim: true,
    },
    /** Doctor submits → Super Admin creates on MSG91 → approves for this clinic only. */
    whatsappCampaignTemplate: {
      status: {
        type: String,
        enum: ['none', 'draft', 'pending', 'approved', 'rejected'],
        default: 'none',
      },
      /** Doctor’s requested MSG91/Meta template name */
      requestedName: { type: String, default: '', trim: true },
      /** Suggested body text for Super Admin to paste into MSG91 (may include {{1}} {{2}}) */
      sampleBody: { type: String, default: '', trim: true },
      /** Doctor’s suggested variable order, e.g. patientName,clinicName,_message */
      requestedBodyVars: { type: String, default: 'patientName,clinicName,_message', trim: true },
      language: { type: String, default: 'en', trim: true },
      category: { type: String, default: 'MARKETING', trim: true },
      submittedAt: { type: Date, default: null },
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      /** Exact name after Super Admin confirms MSG91 Approval */
      approvedName: { type: String, default: '', trim: true },
      approvedBodyVars: { type: String, default: '', trim: true },
      reviewNote: { type: String, default: '', trim: true },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    website: { type: String, default: '', trim: true },
    registrationNumber: { type: String, default: '', trim: true },
    gstNumber: { type: String, default: '', trim: true },
    taxEnabled: { type: Boolean, default: false },
    taxRate: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '₹' },
    expiryWarningDays: { type: Number, default: 60, min: 1, max: 365 },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Clinic = mongoose.model('Clinic', clinicSchema);
export default Clinic;
