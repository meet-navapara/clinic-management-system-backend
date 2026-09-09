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
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Clinic = mongoose.model('Clinic', clinicSchema);
export default Clinic;
