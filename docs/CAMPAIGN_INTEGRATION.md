# Campaign & communication integrations

This clinic app sends campaigns through **real providers only**. If credentials are missing, send/test are blocked with `Provider not configured`.

## Channels

| Channel | Provider | Status when unconfigured |
|---------|----------|--------------------------|
| WhatsApp | MSG91 WhatsApp template API | Blocked |
| SMS | MSG91 Flow / sendhttp | Blocked |
| Email | Resend | Blocked |

There is **no mock send**. WhatsApp deep-links (`wa.me`) are no longer used for campaigns.

## Required environment variables

Add to `clinic-backend/.env` (never commit real secrets):

```bash
# MSG91 (WhatsApp + SMS)
MSG91_AUTH_KEY=
MSG91_WHATSAPP_NUMBER=          # integrated WhatsApp number on MSG91
MSG91_WHATSAPP_TEMPLATE_NAME=   # approved template name
MSG91_WHATSAPP_NAMESPACE=       # optional
MSG91_WHATSAPP_LANGUAGE=en
MSG91_WHATSAPP_BODY_VARS=patientName,clinicName,doctorName
# Optional override:
# MSG91_WHATSAPP_API_URL=https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/

MSG91_SMS_SENDER_ID=            # 6-char sender ID
MSG91_SMS_ROUTE=4
MSG91_SMS_TEMPLATE_ID=          # required for DLT Flow API (recommended in India)

# Resend (Email)
RESEND_API_KEY=
EMAIL_FROM=Clinic Name <clinic@yourdomain.com>
EMAIL_REPLY_TO=

# Webhooks (optional but recommended)
COMMS_WEBHOOK_SECRET=
# Public URLs you configure at the provider:
# POST /api/webhooks/comms/msg91?secret=...
# POST /api/webhooks/comms/resend?secret=...
```

## Consent / opt-out

Marketing campaigns respect `Patient.communicationPrefs`:

- `marketingWhatsapp` / `marketingSms` / `marketingEmail` (default true)
- `marketingOptOut` (blocks all marketing channels)
- legacy `sendSms: false` also blocks SMS marketing

Transactional purpose skips marketing opt-out checks (use carefully).

## Scheduler

The existing in-process scheduler (`reminderScheduler`) also processes campaign delivery batches every 60s (25 recipients per tick).

## How to verify a real message

1. Put provider credentials in `.env` and restart the backend.
2. Open **Campaigns** — channel tiles should show **Connected**.
3. Create a campaign with audience that includes **one** known test patient contact.
4. Preview → confirm eligible count.
5. **Send test** to your own phone/email.
6. Confirm the provider dashboard shows the message and a provider message ID is returned.
7. Confirm send to the single-patient audience (or use selected filter later).
8. Open campaign detail — Sent / Failed / Provider ID should update from DB (and webhooks if configured).

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| 503 Provider not configured | Missing env vars |
| WhatsApp 502 | Template name/namespace/language mismatch or unapproved template |
| SMS 502 | Sender ID / DLT template issues |
| Email 502 | Resend domain not verified / bad `EMAIL_FROM` |
| Eligible 0 | Missing phones/emails or marketing opt-out |
