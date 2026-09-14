import mongoose from 'mongoose';

const hoursSchema = new mongoose.Schema(
  {
    Monday: { type: String, default: '09:00-18:00' },
    Tuesday: { type: String, default: '09:00-18:00' },
    Wednesday: { type: String, default: '09:00-18:00' },
    Thursday: { type: String, default: '09:00-18:00' },
    Friday: { type: String, default: '09:00-18:00' },
    Saturday: { type: String, default: '09:00-14:00' },
    Sunday: { type: String, default: 'Closed' },
  },
  { _id: false }
);

const branchSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, default: '' },
    address: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    workingHours: { type: hoursSchema, default: () => ({}) },
    appointmentDuration: { type: Number, default: 30, min: 5 },
    logo: { type: String, default: '' },
    displayTitle: { type: String, default: '', trim: true },
    roomLabel: { type: String, default: 'Room 1', trim: true },
    tokenPrefix: { type: String, default: '', trim: true },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

branchSchema.index({ clinicId: 1, name: 1 });
branchSchema.index({ clinicId: 1, isDefault: 1 });

const Branch = mongoose.model('Branch', branchSchema);
export default Branch;
