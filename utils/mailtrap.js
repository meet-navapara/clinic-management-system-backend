/**
 * Backward-compatible re-exports.
 * Prefer importing from ./sendEmail.js (Resend for real inbox, SMTP fallback).
 */
export {
  sendEmail as sendMailtrapEmail,
  sendOtpEmail as sendMailtrapOtpEmail,
  assertEmailConfigured as assertMailtrapConfigured,
  emailConfigured,
  sendEmail,
  sendOtpEmail,
} from './sendEmail.js';
