import User from '../models/User.js';
import EmailOtp from '../models/EmailOtp.js';
import { normalizeEmail } from '../utils/normalizeContact.js';
import { sendMailtrapOtpEmail } from '../utils/mailtrap.js';
import {
  generateOtpCode,
  hashOtp,
  compareOtp,
  cooldownRemainingMs,
  isOtpExpired,
  isVerificationValid,
  normalizeOtpInput,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_OTP_ATTEMPTS,
  VERIFIED_WINDOW_MS,
  OTP_LENGTH,
} from '../utils/emailOtp.js';

const EMAIL_TAKEN = 'An account with this email already exists.';

async function findOtpRecord(email, purpose) {
  return EmailOtp.findOne({ email, purpose }).select('+otpHash');
}

async function getOrCreateOtpRecord(email, purpose) {
  let record = await findOtpRecord(email, purpose);
  if (!record) {
    record = new EmailOtp({ email, purpose });
  }
  return record;
}

async function issueAndSendOtp({ email, purpose, subject, intro }) {
  let record = await getOrCreateOtpRecord(email, purpose);
  const remaining = cooldownRemainingMs(record?.lastSentAt);
  if (remaining > 0) {
    const err = new Error(
      `Please wait ${Math.ceil(remaining / 1000)} seconds before requesting another code.`
    );
    err.status = 429;
    err.cooldownSeconds = Math.ceil(remaining / 1000);
    throw err;
  }

  const otp = generateOtpCode();
  const otpHash = await hashOtp(otp);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  record.purpose = purpose;
  record.otpHash = otpHash;
  record.expiresAt = expiresAt;
  record.attempts = 0;
  record.lastSentAt = now;
  record.verifiedAt = null;
  record.verifiedUntil = null;
  record.consumedAt = null;
  await record.save();

  try {
    await sendMailtrapOtpEmail({ toEmail: email, otp, subject, intro });
  } catch (sendErr) {
    record.lastSentAt = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    await record.save();
    throw sendErr;
  }

  return {
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    cooldownSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
  };
}

async function verifyOtpCode({ email, otp, purpose }) {
  const record = await findOtpRecord(email, purpose);
  if (!record || !record.otpHash) {
    const err = new Error('No verification code found. Please request a new code.');
    err.status = 400;
    throw err;
  }

  if (isOtpExpired(record.expiresAt)) {
    record.otpHash = null;
    await record.save();
    const err = new Error('Verification code expired. Please request a new code.');
    err.status = 400;
    throw err;
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    const err = new Error('Too many incorrect attempts. Please request a new code.');
    err.status = 429;
    throw err;
  }

  const match = await compareOtp(otp, record.otpHash);
  if (!match) {
    record.attempts += 1;
    await record.save();
    const left = Math.max(0, MAX_OTP_ATTEMPTS - record.attempts);
    const err = new Error(
      left > 0
        ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Please request a new code.'
    );
    err.status = 400;
    err.attemptsRemaining = left;
    throw err;
  }

  const now = new Date();
  record.otpHash = null;
  record.expiresAt = null;
  record.attempts = 0;
  record.verifiedAt = now;
  record.verifiedUntil = new Date(now.getTime() + VERIFIED_WINDOW_MS);
  record.consumedAt = null;
  await record.save();
  return record;
}

export async function consumeEmailVerification(email, purpose = 'signup') {
  const normalized = normalizeEmail(email);
  const record = await EmailOtp.findOne({ email: normalized, purpose });
  if (!isVerificationValid(record)) {
    const err = new Error('Please verify your email before creating an account.');
    err.status = 403;
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }
  record.consumedAt = new Date();
  record.otpHash = null;
  await record.save();
  return record;
}

export async function sendSignupEmailOtp(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email || !email.includes('@')) {
      return res.status(422).json({
        success: false,
        message: 'Valid email is required.',
        errors: { email: 'Valid email is required.' },
      });
    }

    const existing = await User.findOne({ email }).select('_id');
    if (existing) {
      return res.status(409).json({
        success: false,
        message: EMAIL_TAKEN,
        errors: { email: EMAIL_TAKEN },
      });
    }

    const meta = await issueAndSendOtp({
      email,
      purpose: 'signup',
      subject: 'Your Z Health verification code',
      intro: 'Your verification code is:',
    });

    return res.json({
      success: true,
      message: 'Verification code sent to your email.',
      ...meta,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Could not send verification code.',
      ...(error.cooldownSeconds ? { cooldownSeconds: error.cooldownSeconds } : {}),
    });
  }
}

export async function verifySignupEmailOtp(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = normalizeOtpInput(req.body.otp);

    if (!email || !email.includes('@')) {
      return res.status(422).json({
        success: false,
        message: 'Valid email is required.',
        errors: { email: 'Valid email is required.' },
      });
    }
    if (otp.length !== OTP_LENGTH) {
      return res.status(422).json({
        success: false,
        message: `Enter the ${OTP_LENGTH}-digit verification code.`,
        errors: { otp: `Enter the ${OTP_LENGTH}-digit verification code.` },
      });
    }

    const record = await verifyOtpCode({ email, otp, purpose: 'signup' });
    return res.json({
      success: true,
      message: 'Email verified successfully.',
      verified: true,
      verifiedUntil: record.verifiedUntil,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Could not verify code.',
      ...(error.attemptsRemaining != null ? { attemptsRemaining: error.attemptsRemaining } : {}),
    });
  }
}
