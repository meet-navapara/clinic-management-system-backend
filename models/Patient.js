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
  },
  { _id: false }
);

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
    /** Human-readable ID e.g. PAT-000001 */
    patientCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    preferredName: { type: String, trim: true, default: '' },
    /** Denormalized full name for search/display */
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
    state: { type: String, default: '', trim: true },
    postalCode: { type: String, default: '', trim: true },
    emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
    clinical: { type: clinicalProfileSchema, default: () => ({}) },
    /** Legacy free-text fields (kept + synced into clinical where useful) */
    medicalHistory: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

patientSchema.index({ doctorId: 1, phone: 1 });
patientSchema.index({ clinicId: 1, name: 1 });
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
