import mongoose from 'mongoose';

/**
 * Email OTP for signup and password-reset flows.
 * OTP hash is never returned to clients; plaintext OTP is never stored.
 */
const emailOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['signup', 'password_reset'],
      default: 'signup',
      index: true,
    },
    otpHash: {
      type: String,
      select: false,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    /** Action allowed until this time after successful OTP verify. */
    verifiedUntil: {
      type: Date,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

emailOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });
emailOtpSchema.index({ verifiedUntil: 1 });

export default mongoose.model('EmailOtp', emailOtpSchema);
