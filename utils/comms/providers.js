import { indianMobileDigits, normalizeEmail } from '../normalizeContact.js';

function msg91BaseReady() {
  return Boolean(process.env.MSG91_AUTH_KEY?.trim() && process.env.MSG91_WHATSAPP_NUMBER?.trim());
}

function appointmentTemplateReady() {
  return Boolean(msg91BaseReady() && process.env.MSG91_WHATSAPP_TEMPLATE_NAME?.trim());
}

function clinicCampaignApproved(clinic) {
  const t = clinic?.whatsappCampaignTemplate;
  return Boolean(t?.status === 'approved' && String(t.approvedName || '').trim());
}

/**
 * Provider configuration status — never expose secrets.
 * Pass clinic for campaign WhatsApp status (clinic-approved template only).
 */
export function getCommsConfigStatus(clinic = null) {
  const msg91Key = Boolean(process.env.MSG91_AUTH_KEY?.trim());
  const hasNumber = Boolean(process.env.MSG91_WHATSAPP_NUMBER?.trim());
  const appointmentName = process.env.MSG91_WHATSAPP_TEMPLATE_NAME?.trim() || '';

  const whatsappMissing = [];
  if (!msg91Key) whatsappMissing.push('MSG91_AUTH_KEY');
  if (!hasNumber) whatsappMissing.push('MSG91_WHATSAPP_NUMBER');
  if (!appointmentName) whatsappMissing.push('MSG91_WHATSAPP_TEMPLATE_NAME');

  const tpl = clinic?.whatsappCampaignTemplate || null;
  const campaignApproved = clinicCampaignApproved(clinic);
  const campaignMissing = [];
  if (!msg91Key) campaignMissing.push('MSG91_AUTH_KEY');
  if (!hasNumber) campaignMissing.push('MSG91_WHATSAPP_NUMBER');
  if (!campaignApproved) {
    if (!tpl || tpl.status === 'none' || tpl.status === 'draft') {
      campaignMissing.push('Clinic campaign template (submit for Super Admin approval)');
    } else if (tpl.status === 'pending') {
      campaignMissing.push('Super Admin approval (pending)');
    } else if (tpl.status === 'rejected') {
      campaignMissing.push('Resubmit campaign template after rejection');
    } else {
      campaignMissing.push('Approved clinic campaign template');
    }
  }

  const whatsapp = {
    // Appointment confirmations / reminders (global MSG91 template)
    configured: appointmentTemplateReady(),
    provider: 'msg91',
    missing: whatsappMissing,
    // Campaigns — per-clinic template approved by Super Admin (never uses appointment template)
    campaign: {
      configured: Boolean(msg91BaseReady() && campaignApproved),
      missing: campaignMissing,
      status: tpl?.status || 'none',
      requestedName: tpl?.requestedName || '',
      sampleBody: tpl?.sampleBody || '',
      requestedBodyVars: tpl?.requestedBodyVars || 'patientName,clinicName,_message',
      language: tpl?.language || 'en',
      category: tpl?.category || 'MARKETING',
      approvedName: tpl?.approvedName || '',
      approvedBodyVars: tpl?.approvedBodyVars || '',
      reviewNote: tpl?.reviewNote || '',
      submittedAt: tpl?.submittedAt || null,
      reviewedAt: tpl?.reviewedAt || null,
      campaignTemplate: campaignApproved ? tpl.approvedName : null,
      usingFallbackAppointmentTemplate: false,
    },
  };

  const email = {
    configured: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),
    provider: 'resend',
    missing: [],
  };
  if (!process.env.RESEND_API_KEY?.trim()) email.missing.push('RESEND_API_KEY');
  if (!process.env.EMAIL_FROM?.trim()) email.missing.push('EMAIL_FROM');

  return { whatsapp, email };
}

/**
 * @param {'whatsapp'|'email'|'sms'} channel
 * @param {{ clinic?: object, purpose?: 'appointment'|'campaign' }} opts
 */
export function assertChannelConfigured(channel, opts = {}) {
  if (channel === 'sms') {
    const err = new Error('SMS campaigns are not supported. Use WhatsApp or Email.');
    err.status = 400;
    err.code = 'CHANNEL_REMOVED';
    throw err;
  }
  const purpose = opts.purpose || 'appointment';
  const status = getCommsConfigStatus(opts.clinic || null);
  if (channel === 'email') {
    if (!status.email?.configured) {
      const err = new Error(
        `EMAIL integration is not configured. Required: ${(status.email?.missing || []).join(', ') || 'provider credentials'}.`
      );
      err.status = 503;
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }
    return status.email;
  }
  if (purpose === 'campaign') {
    const cfg = status.whatsapp?.campaign;
    if (!cfg?.configured) {
      const err = new Error(
        `WhatsApp campaigns need a clinic template approved by Super Admin. ${(cfg?.missing || []).join('; ')}`
      );
      err.status = 503;
      err.code = 'CAMPAIGN_TEMPLATE_NOT_APPROVED';
      throw err;
    }
    return cfg;
  }
  if (!status.whatsapp?.configured) {
    const err = new Error(
      `WHATSAPP integration is not configured. Required: ${(status.whatsapp?.missing || []).join(', ') || 'provider credentials'}.`
    );
    err.status = 503;
    err.code = 'PROVIDER_NOT_CONFIGURED';
    throw err;
  }
  return status.whatsapp;
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
 * Template already says "Dr. {{doctorName}}" — strip titles so we don't get "Dr. Dr. Patel".
 */
export function stripDoctorTitle(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Doctor';
  return raw.replace(/^(dr\.?|doctor)\s+/i, '').trim() || 'Doctor';
}

/** "11:00" / "11:00:00" → "11:00 AM" */
export function formatWhatsAppTime(slot) {
  const s = String(slot || '').trim();
  if (!s) return ' ';
  if (/\b(am|pm)\b/i.test(s)) return s.replace(/\s+/g, ' ');
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return s;
  let h = Number(m[1]);
  const min = m[2];
  if (!Number.isFinite(h) || h < 0 || h > 23) return s;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

/** Prefer "19 September 2026" (no weekday) for cleaner templates. */
export function formatWhatsAppDate(labelOrDate) {
  if (labelOrDate == null || labelOrDate === '') return ' ';
  if (labelOrDate instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(labelOrDate))) {
    const d = new Date(labelOrDate);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  return String(labelOrDate).replace(/^[A-Za-z]+,\s*/, '').trim() || ' ';
}

/** Normalize context keys used by MSG91 body vars before send. */
export function normalizeWhatsAppTemplateContext(context = {}) {
  return {
    ...context,
    doctorName: stripDoctorTitle(context.doctorName),
    dateLabel: formatWhatsAppDate(context.dateLabel ?? context.appointmentDate),
    timeSlot: formatWhatsAppTime(context.timeSlot),
    patientName: String(context.patientName || 'Patient').trim() || 'Patient',
    clinicName: String(context.clinicName || 'Clinic').trim() || 'Clinic',
    campaignName: String(context.campaignName || ' ').trim() || ' ',
  };
}

/**
 * MSG91 WhatsApp template send.
 * templateKind: 'confirmation' | 'reminder' | 'campaign' | 'default'
 * Campaigns require campaignTemplateName from the clinic’s Super-Admin-approved template.
 * Never falls back to appointment_confirmation for campaigns.
 */
export async function sendWhatsAppMessage({
  toPhone,
  bodyText,
  context = {},
  templateKind = 'default',
  campaignTemplateName = '',
  campaignBodyVars = '',
  campaignLanguage = '',
}) {
  const purpose = templateKind === 'campaign' ? 'campaign' : 'appointment';
  if (purpose === 'appointment') {
    assertChannelConfigured('whatsapp', { purpose: 'appointment' });
  } else if (!String(campaignTemplateName || '').trim()) {
    const err = new Error(
      'Clinic campaign WhatsApp template is not approved yet. Ask Super Admin after MSG91 approval.'
    );
    err.status = 503;
    err.code = 'CAMPAIGN_TEMPLATE_NOT_APPROVED';
    throw err;
  }

  const digits = indianMobileDigits(toPhone);
  if (!digits) {
    const err = new Error('Invalid WhatsApp phone number.');
    err.status = 422;
    throw err;
  }

  const authkey = process.env.MSG91_AUTH_KEY.trim();
  const integratedNumber = process.env.MSG91_WHATSAPP_NUMBER.trim();
  const confirmationTemplate = process.env.MSG91_WHATSAPP_TEMPLATE_NAME?.trim() || '';
  const reminderTemplate = process.env.MSG91_WHATSAPP_REMINDER_TEMPLATE_NAME?.trim();

  let templateName = confirmationTemplate;
  let varSource =
    process.env.MSG91_WHATSAPP_BODY_VARS || 'patientName,clinicName,doctorName,dateLabel,timeSlot';

  if (templateKind === 'reminder' && reminderTemplate) {
    templateName = reminderTemplate;
    if (process.env.MSG91_WHATSAPP_REMINDER_BODY_VARS?.trim()) {
      varSource = process.env.MSG91_WHATSAPP_REMINDER_BODY_VARS;
    }
  } else if (templateKind === 'campaign') {
    templateName = String(campaignTemplateName).trim();
    varSource =
      String(campaignBodyVars || '').trim() ||
      'patientName,clinicName,_message';
  }

  if (!templateName) {
    const err = new Error('WhatsApp template name is missing.');
    err.status = 503;
    throw err;
  }

  const namespace = process.env.MSG91_WHATSAPP_NAMESPACE || '';
  const languageCode =
    (templateKind === 'campaign' && String(campaignLanguage || '').trim()) ||
    process.env.MSG91_WHATSAPP_LANGUAGE ||
    'en';

  const normalized = normalizeWhatsAppTemplateContext(context);
  const varKeys = String(varSource)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bodyValues = varKeys.map((k) => {
    if (k === '_message') return bodyText;
    return normalized[k] != null ? String(normalized[k]) : '';
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
        to_and_components: [
          {
            to: [digits],
            components,
          },
        ],
      },
    },
  };
  if (namespace.trim()) {
    payload.payload.template.namespace = namespace.trim();
  }

  const endpoint =
    process.env.MSG91_WHATSAPP_API_URL ||
    'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

  const { ok, status, data } = await postJson(endpoint, {
    headers: { authkey },
    body: payload,
  });

  if (!ok) {
    const detail =
      (typeof data?.errors === 'string' && data.errors) ||
      (Array.isArray(data?.errors) && data.errors.map((e) => e?.message || e).join('; ')) ||
      data?.message ||
      data?.error ||
      data?.apiError ||
      data?.raw ||
      `HTTP ${status}`;
    const err = new Error(`WhatsApp provider rejected the request: ${detail}`);
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

/** MSG91 SMS — kept for legacy callers; campaigns no longer use SMS. */
export async function sendSmsMessage({ toPhone, bodyText }) {
  const err = new Error('SMS is not supported. Use WhatsApp or Email.');
  err.status = 400;
  throw err;
}

export async function sendEmailMessage({ toEmail, subject, text, html }) {
  assertChannelConfigured('email');
  const email = normalizeEmail(toEmail);
  if (!email) {
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
  if (channel === 'sms') {
    const err = new Error('SMS is not supported. Use WhatsApp or Email.');
    err.status = 400;
    throw err;
  }
  if (channel === 'whatsapp') return sendWhatsAppMessage(payload);
  if (channel === 'email') return sendEmailMessage(payload);
  const err = new Error(`Unsupported channel: ${channel}`);
  err.status = 400;
  throw err;
}
