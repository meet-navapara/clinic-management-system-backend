import mongoose from 'mongoose';

/**
 * Doctor-owned patient records — no login/password.
 */
const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    relationship: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const clinicalProfileSchema = new mongoose.Schema(
  {
    allergies: { type: [String], default: [] },
    conditions: { type: [String], default: [] },
    medications: { type: [String], default: [] },
    medicalHistory: { type: String, default: '', trim: true },
    familyHistory: { type: String, default: '', trim: true },
    surgeries: { type: String, default: '', trim: true },
    alerts: { type: [String], default: [] },
    otherHistory: { type: String, default: '', trim: true },
    historyTags: { type: [String], default: [] },
  },
  { _id: false }
);

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];

const patientSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    tags: { type: [String], default: [] },
    patientCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    firstName: { type: String, trim: true, default: '' },
    middleName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    preferredName: { type: String, trim: true, default: '' },
    name: {
      type: String,
      required: [true, 'Patient name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      index: true,
    },
    secondaryPhone: { type: String, default: '', trim: true },
    email: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    dateOfBirth: { type: Date, default: null },
    age: { type: Number, default: null, min: 0, max: 150 },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say', ''],
      default: '',
    },
    address: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    area: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    postalCode: { type: String, default: '', trim: true },
    bloodGroup: {
      type: String,
      enum: [...BLOOD_GROUPS, ''],
      default: '',
    },
    occupation: { type: String, default: '', trim: true },
    nhId: { type: String, default: '', trim: true },
    aadharNumber: { type: String, default: '', trim: true },
    caseId: { type: String, default: '', trim: true },
    referredBy: { type: String, default: '', trim: true },
    room: { type: String, default: '', trim: true },
    patientCategory: { type: String, default: 'Patient', trim: true },
    linkedPatientName: { type: String, default: '', trim: true },
    sendSms: { type: Boolean, default: true },
    admitPatient: { type: Boolean, default: false },
    profilePhoto: { type: String, default: '' },
    emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
    clinical: { type: clinicalProfileSchema, default: () => ({}) },
    medicalHistory: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

patientSchema.index({ doctorId: 1, phone: 1 });
patientSchema.index({ clinicId: 1, name: 1 });
patientSchema.index({ clinicId: 1, branchId: 1, isActive: 1 });
patientSchema.index({ doctorId: 1, patientCode: 1 });
patientSchema.index({
  name: 'text',
  firstName: 'text',
  lastName: 'text',
  phone: 'text',
  email: 'text',
  patientCode: 'text',
});

const Patient = mongoose.model('Patient', patientSchema);
export default Patient;
