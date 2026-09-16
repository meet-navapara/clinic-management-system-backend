import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
/** How long a successful verification remains valid for signup. */
export const VERIFIED_WINDOW_MS = 30 * 60 * 1000;

export function generateOtpCode() {
  return String(crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH));
}

export async function hashOtp(otp) {
  return bcrypt.hash(String(otp), 10);
}

export async function compareOtp(otp, otpHash) {
  if (!otp || !otpHash) return false;
  return bcrypt.compare(String(otp), otpHash);
}

export function cooldownRemainingMs(lastSentAt, now = Date.now()) {
  if (!lastSentAt) return 0;
  const elapsed = now - new Date(lastSentAt).getTime();
  return Math.max(0, RESEND_COOLDOWN_MS - elapsed);
}

export function isOtpExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= now;
}

export function isVerificationValid(doc, now = Date.now()) {
  if (!doc?.verifiedAt || !doc?.verifiedUntil) return false;
  if (doc.consumedAt) return false;
  return new Date(doc.verifiedUntil).getTime() > now;
}

export function normalizeOtpInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, OTP_LENGTH);
}
