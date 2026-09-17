import nodemailer from 'nodemailer';
import { normalizeEmail } from './normalizeContact.js';

function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST?.trim() ||
      (process.env.MAILTRAP_HOST?.trim() &&
        process.env.MAILTRAP_USER?.trim() &&
        process.env.MAILTRAP_PASS?.trim() &&
        process.env.MAILTRAP_FROM?.trim())
  );
}

export function emailConfigured() {
  return resendConfigured() || smtpConfigured();
}

export function assertEmailConfigured() {
  if (emailConfigured()) return;
  const err = new Error(
    'Email is not configured. For real inbox delivery set RESEND_API_KEY and EMAIL_FROM. For local SMTP set SMTP_* or MAILTRAP_*.'
  );
  err.status = 503;
  err.code = 'EMAIL_NOT_CONFIGURED';
  throw err;
}

async function sendViaResend({ toEmail, subject, text, html }) {
  const from = process.env.EMAIL_FROM.trim();
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject,
      html: html || `<p>${String(text || '').replace(/\n/g, '<br/>')}</p>`,
      text: text || '',
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || `Email provider rejected the request (${res.status}).`);
    err.status = 502;
    throw err;
  }
  return { provider: 'resend', id: data?.id ? String(data.id) : null };
}

function createSmtpTransport() {
  const host = (process.env.SMTP_HOST || process.env.MAILTRAP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || process.env.MAILTRAP_PORT || 587);
  const user = (process.env.SMTP_USER || process.env.MAILTRAP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || process.env.MAILTRAP_PASS || '').trim();
  const from = (process.env.SMTP_FROM || process.env.MAILTRAP_FROM || process.env.EMAIL_FROM || '').trim();
  if (!host || !user || !pass || !from) {
    const err = new Error('SMTP is not fully configured (HOST, USER, PASS, FROM).');
    err.status = 503;
    throw err;
  }
  return {
    from,
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    }),
  };
}

async function sendViaSmtp({ toEmail, subject, text, html }) {
  const { from, transporter } = createSmtpTransport();
  await transporter.sendMail({ from, to: toEmail, subject, text, html });
  return { provider: 'smtp' };
}

/**
 * Send email: Resend (real inbox) preferred, else SMTP / Mailtrap.
 */
export async function sendEmail({ toEmail, subject, text, html }) {
  assertEmailConfigured();
  const email = normalizeEmail(toEmail);
  if (!email || !email.includes('@')) {
    const err = new Error('Invalid email address.');
    err.status = 422;
    throw err;
  }

  if (resendConfigured()) {
    return sendViaResend({ toEmail: email, subject, text, html });
  }
  return sendViaSmtp({ toEmail: email, subject, text, html });
}

/**
 * Send OTP email. Never log the OTP code.
 */
export async function sendOtpEmail({
  toEmail,
  otp,
  subject = 'Your Z Health verification code',
  intro = 'Your verification code is:',
}) {
  const text = `${intro} ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`;
  const html = `
    <p>${intro}</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:4px;">${otp}</p>
    <p>This code expires in <strong>10 minutes</strong>.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;
  return sendEmail({ toEmail, subject, text, html });
}

/** @deprecated Use sendEmail / sendOtpEmail */
export async function sendMailtrapEmail(args) {
  return sendEmail(args);
}

/** @deprecated Use sendOtpEmail */
export async function sendMailtrapOtpEmail(args) {
  return sendOtpEmail(args);
}

export function assertMailtrapConfigured() {
  assertEmailConfigured();
}
