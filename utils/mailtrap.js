import nodemailer from 'nodemailer';
import { normalizeEmail } from './normalizeContact.js';

function mailtrapConfigured() {
  return Boolean(
    process.env.MAILTRAP_HOST?.trim() &&
      process.env.MAILTRAP_USER?.trim() &&
      process.env.MAILTRAP_PASS?.trim() &&
      process.env.MAILTRAP_FROM?.trim()
  );
}

export function assertMailtrapConfigured() {
  if (!mailtrapConfigured()) {
    const err = new Error(
      'Email OTP is not configured. Required: MAILTRAP_HOST, MAILTRAP_USER, MAILTRAP_PASS, MAILTRAP_FROM.'
    );
    err.status = 503;
    err.code = 'MAILTRAP_NOT_CONFIGURED';
    throw err;
  }
}

/**
 * Send OTP via Mailtrap SMTP.
 * Never log the OTP code.
 */
export async function sendMailtrapOtpEmail({
  toEmail,
  otp,
  subject = 'Your Z Health verification code',
  intro = 'Your verification code is:',
}) {
  assertMailtrapConfigured();
  const email = normalizeEmail(toEmail);
  if (!email || !email.includes('@')) {
    const err = new Error('Invalid email address.');
    err.status = 422;
    throw err;
  }

  const host = process.env.MAILTRAP_HOST.trim();
  const port = Number(process.env.MAILTRAP_PORT || 2525);
  const user = process.env.MAILTRAP_USER.trim();
  const pass = process.env.MAILTRAP_PASS.trim();
  const from = process.env.MAILTRAP_FROM.trim();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const text = `${intro} ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`;
  const html = `
    <p>${intro}</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:4px;">${otp}</p>
    <p>This code expires in <strong>10 minutes</strong>.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  await transporter.sendMail({ from, to: email, subject, text, html });
  return { provider: 'mailtrap' };
}
