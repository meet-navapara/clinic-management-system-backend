import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/** Auth roles. `patient` / `receptionist` retained only for legacy DB rows — login is blocked. */
export const USER_ROLES = [
  'super_admin',
  'clinic_admin',
  'doctor',
  'receptionist',
  'patient',
];

export const ADMIN_ROLES = ['clinic_admin', 'super_admin'];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DEFAULT_SLOTS = [
  '09:00',
  '10:00',
  '11:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
];

const practiceSettingsSchema = new mongoose.Schema(
  {
    defaultDurationMinutes: { type: Number, default: 30, min: 5, max: 240 },
    reminderHoursBefore: { type: [Number], default: [24, 2] },
    sendConfirmationReminder: { type: Boolean, default: true },
    appointmentTypes: {
      type: [String],
      default: ['Consultation', 'Follow-up', 'Procedure'],
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    firstName: { type: String, default: '', trim: true },
    lastName: { type: String, default: '', trim: true },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      required: true,
    },
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: APPROVAL_STATUSES,
      default: 'approved',
      index: true,
    },
    specialization: { type: String, trim: true, default: '' },
    qualification: { type: String, trim: true, default: '' },
    experience: { type: Number, default: 0 },
    licenseNumber: { type: String, trim: true, default: '' },
    consultationFee: { type: Number, default: 500 },
    consultationTypes: { type: [String], default: [] },
    bio: { type: String, default: '' },
    clinicName: { type: String, trim: true, default: '' },
    clinicAddress: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' },
    availableDays: {
      type: [String],
      enum: DAYS,
      default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    },
    availableSlots: {
      type: [String],
      default: DEFAULT_SLOTS,
    },
    practiceSettings: {
      type: practiceSettingsSchema,
      default: () => ({}),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    profilePhoto: {
      type: String,
      default: '',
    },
    lastActiveAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isDoctorApproved = function () {
  if (this.role !== 'doctor') return true;
  return this.approvalStatus === 'approved' && this.isActive !== false;
};

userSchema.methods.canAccessDoctorDashboard = function () {
  return this.role === 'doctor' && this.isDoctorApproved();
};

const User = mongoose.model('User', userSchema);
export default User;
