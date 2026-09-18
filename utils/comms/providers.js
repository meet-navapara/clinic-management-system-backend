import { indianMobileDigits, normalizeEmail } from '../normalizeContact.js';

/**
 * Provider configuration status — never expose secrets.
 */
export function getCommsConfigStatus() {
  const msg91Key = Boolean(process.env.MSG91_AUTH_KEY?.trim());
  const whatsapp = {
    configured: Boolean(
      msg91Key &&
        process.env.MSG91_WHATSAPP_NUMBER?.trim() &&
        process.env.MSG91_WHATSAPP_TEMPLATE_NAME?.trim()
    ),
    provider: 'msg91',
    missing: [],
  };
  if (!msg91Key) whatsapp.missing.push('MSG91_AUTH_KEY');
  if (!process.env.MSG91_WHATSAPP_NUMBER?.trim()) whatsapp.missing.push('MSG91_WHATSAPP_NUMBER');
  if (!process.env.MSG91_WHATSAPP_TEMPLATE_NAME?.trim()) {
    whatsapp.missing.push('MSG91_WHATSAPP_TEMPLATE_NAME');
  }

  const sms = {
    configured: Boolean(msg91Key && process.env.MSG91_SMS_SENDER_ID?.trim()),
    provider: 'msg91',
    missing: [],
  };
  if (!msg91Key) sms.missing.push('MSG91_AUTH_KEY');
  if (!process.env.MSG91_SMS_SENDER_ID?.trim()) sms.missing.push('MSG91_SMS_SENDER_ID');

  const email = {
    configured: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),
    provider: 'resend',
    missing: [],
  };
  if (!process.env.RESEND_API_KEY?.trim()) email.missing.push('RESEND_API_KEY');
  if (!process.env.EMAIL_FROM?.trim()) email.missing.push('EMAIL_FROM');

  return { whatsapp, sms, email };
}

export function assertChannelConfigured(channel) {
  const status = getCommsConfigStatus();
  const key = channel === 'whatsapp' ? 'whatsapp' : channel === 'sms' ? 'sms' : 'email';
  const cfg = status[key];
  if (!cfg?.configured) {
    const err = new Error(
      `${String(channel).toUpperCase()} integration is not configured. Required: ${(cfg?.missing || []).join(', ') || 'provider credentials'}.`
    );
    err.status = 503;
    err.code = 'PROVIDER_NOT_CONFIGURED';
    throw err;
  }
  return cfg;
}

async function postJson(url, { headers = {}, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * MSG91 WhatsApp template send.
 * Uses approved template; variables come from MSG91_WHATSAPP_BODY_VARS (comma-separated keys).
 */
export async function sendWhatsAppMessage({ toPhone, bodyText, context = {} }) {
  assertChannelConfigured('whatsapp');
  const digits = indianMobileDigits(toPhone);
  if (!digits) {
    const err = new Error('Invalid WhatsApp phone number.');
    err.status = 422;
    throw err;
  }

  const authkey = process.env.MSG91_AUTH_KEY.trim();
  const integratedNumber = process.env.MSG91_WHATSAPP_NUMBER.trim();
  // Optional reminder-specific template; falls back to campaign template name
  const templateName = (
    process.env.MSG91_WHATSAPP_REMINDER_TEMPLATE_NAME?.trim() ||
    process.env.MSG91_WHATSAPP_TEMPLATE_NAME.trim()
  );
  const namespace = process.env.MSG91_WHATSAPP_NAMESPACE || '';
  const languageCode = process.env.MSG91_WHATSAPP_LANGUAGE || 'en';

  const varKeys = String(
    process.env.MSG91_WHATSAPP_BODY_VARS || 'patientName,clinicName,doctorName,dateLabel,timeSlot'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bodyValues = varKeys.map((k) => {
    if (k === '_message') return bodyText;
    return context[k] != null ? String(context[k]) : '';
  });

  const components = {};
  bodyValues.forEach((value, idx) => {
    components[`body_${idx + 1}`] = { type: 'text', value: value || ' ' };
  });

  const payload = {
    integrated_number: integratedNumber,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode, policy: 'deterministic' },
        namespace,
        to_and_components: [
          {
            to: [digits],
            components,
          },
        ],
      },
    },
  };

  const endpoint =
    process.env.MSG91_WHATSAPP_API_URL ||
    'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

  const { ok, status, data } = await postJson(endpoint, {
    headers: { authkey },
    body: payload,
  });

  if (!ok) {
    const err = new Error(
      data?.message || data?.error || `WhatsApp provider rejected the request (${status}).`
    );
    err.status = 502;
    err.providerResponse = { status, data };
    throw err;
  }

  const providerMessageId =
    data?.data?.message_uuid ||
    data?.message_uuid ||
    data?.request_id ||
    data?.data?.id ||
    data?.id ||
    null;

  return {
    provider: 'msg91',
    providerMessageId: providerMessageId ? String(providerMessageId) : null,
    raw: { status, id: providerMessageId },
  };
}

/** MSG91 SMS — Flow API when template id set, else classic sendhttp. */
export async function sendSmsMessage({ toPhone, bodyText }) {
  assertChannelConfigured('sms');
  const digits = indianMobileDigits(toPhone);
  if (!digits) {
    const err = new Error('Invalid SMS phone number.');
    err.status = 422;
    throw err;
  }

  const authkey = process.env.MSG91_AUTH_KEY.trim();
  const sender = process.env.MSG91_SMS_SENDER_ID.trim();
  const route = process.env.MSG91_SMS_ROUTE || '4';
  const templateId = process.env.MSG91_SMS_TEMPLATE_ID || '';

  if (templateId) {
    const { ok, status, data } = await postJson('https://control.msg91.com/api/v5/flow/', {
      headers: { authkey },
      body: {
        template_id: templateId,
        short_url: '0',
        recipients: [{ mobiles: digits, VAR1: String(bodyText || '').slice(0, 120) }],
        sender,
        route,
      },
    });
    if (!ok) {
      const err = new Error(data?.message || `SMS provider rejected the request (${status}).`);
      err.status = 502;
      throw err;
    }
    return {
      provider: 'msg91',
      providerMessageId: String(data?.message || data?.request_id || data?.type || ''),
      raw: data,
    };
  }

  const classic = new URL('https://control.msg91.com/api/sendhttp.php');
  classic.searchParams.set('authkey', authkey);
  classic.searchParams.set('mobiles', digits);
  classic.searchParams.set('message', bodyText);
  classic.searchParams.set('sender', sender);
  classic.searchParams.set('route', route);
  classic.searchParams.set('country', '91');

  const res = await fetch(classic.toString());
  const text = await res.text();
  if (!res.ok || /error|invalid/i.test(text)) {
    const err = new Error(`SMS provider error: ${text.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }
  return { provider: 'msg91', providerMessageId: text.trim(), raw: { response: text } };
}

/** Resend email API */
export async function sendEmailMessage({ toEmail, subject, html, text }) {
  assertChannelConfigured('email');
  const email = normalizeEmail(toEmail);
  if (!email || !email.includes('@')) {
    const err = new Error('Invalid email address.');
    err.status = 422;
    throw err;
  }

  const { ok, status, data } = await postJson('https://api.resend.com/emails', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}` },
    body: {
      from: process.env.EMAIL_FROM.trim(),
      to: [email],
      subject: subject || 'Message from your clinic',
      html: html || `<p>${String(text || '').replace(/\n/g, '<br/>')}</p>`,
      text: text || '',
      ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO.trim() } : {}),
    },
  });

  if (!ok) {
    const err = new Error(data?.message || `Email provider rejected the request (${status}).`);
    err.status = 502;
    throw err;
  }

  return {
    provider: 'resend',
    providerMessageId: data?.id ? String(data.id) : null,
    raw: data,
  };
}

export async function sendViaChannel(channel, payload) {
  if (channel === 'whatsapp') return sendWhatsAppMessage(payload);
  if (channel === 'sms') return sendSmsMessage(payload);
  if (channel === 'email') return sendEmailMessage(payload);
  const err = new Error(`Unsupported channel: ${channel}`);
  err.status = 400;
  throw err;
}
