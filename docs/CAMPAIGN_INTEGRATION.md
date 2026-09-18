# Campaign & communication integrations

This clinic app sends campaigns **and appointment WhatsApp reminders** through **real providers only**. If credentials are missing, sends are blocked (no mock / fake "sent").

## Channels

| Channel | Provider | Used for | Status when unconfigured |
|---------|----------|----------|--------------------------|
| WhatsApp | MSG91 WhatsApp template API | Campaigns + appointment confirmations/reminders | Blocked / reminder marked failed |
| SMS | MSG91 Flow / sendhttp | Campaigns | Blocked |
| Email | Resend | Campaigns + OTP / password reset | Blocked |

There is **no mock send**. Manual `wa.me` deep-links remain available for staff "Open WhatsApp" buttons only — they are **not** used for automatic reminders.

## Required environment variables

Add to `clinic-management-system-backend/.env` (never commit real secrets):

```bash
# MSG91 (WhatsApp + SMS)
MSG91_AUTH_KEY=
MSG91_WHATSAPP_NUMBER=          # integrated WhatsApp number on MSG91 (e.g. 91XXXXXXXXXX)
MSG91_WHATSAPP_TEMPLATE_NAME=   # approved Meta template name
MSG91_WHATSAPP_REMINDER_TEMPLATE_NAME=  # optional; defaults to TEMPLATE_NAME
MSG91_WHATSAPP_NAMESPACE=       # optional / from MSG91 dashboard
MSG91_WHATSAPP_LANGUAGE=en
# Must match {{1}}, {{2}}, ... order in your approved template:
MSG91_WHATSAPP_BODY_VARS=patientName,clinicName,doctorName,dateLabel,timeSlot
# Or one full-text variable:
# MSG91_WHATSAPP_BODY_VARS=_message
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

## MSG91 WhatsApp setup (automatic reminders)

1. Create an MSG91 account and enable **WhatsApp**.
2. Connect / verify your business WhatsApp number (`MSG91_WHATSAPP_NUMBER`).
3. Create a **Utility** template (appointment confirmation / reminder), submit for Meta approval.
4. Example template body (5 variables):
   `Hello {{1}}, your appointment with Dr. {{3}} at {{2}} is on {{4}} at {{5}}.`
5. Set `MSG91_WHATSAPP_BODY_VARS=patientName,clinicName,doctorName,dateLabel,timeSlot` to match.
6. Put `MSG91_AUTH_KEY`, number, and template name in `.env` → **restart the backend**.
7. Book a test appointment with a real patient phone → confirmation WhatsApp sends ~30s later via the reminder scheduler.

## Consent / opt-out

Marketing campaigns respect `Patient.communicationPrefs`:

- `marketingWhatsapp` / `marketingSms` / `marketingEmail` (default true)
- `marketingOptOut` (blocks all marketing channels)
- legacy `sendSms: false` also blocks SMS marketing

Transactional purpose (appointment reminders) skips marketing opt-out checks.

## Scheduler

The in-process scheduler (`reminderScheduler`) every ~60s:

- processes due appointment confirmation/reminder WhatsApp sends via MSG91
- processes campaign delivery batches (25 recipients per tick)

## How to verify a real message

1. Put provider credentials in `.env` and restart the backend.
2. Open **Campaigns** — channel tiles should show **Connected**.
3. Create a campaign with audience that includes **one** known test patient contact.
4. Preview → confirm eligible count.
5. **Send test** to your own phone/email.
6. Confirm the provider dashboard shows the message and a provider message ID is returned.
7. For reminders: book an appointment → wait ~30–60s → check patient WhatsApp + `NotificationLog` status `sent` with `provider: msg91`.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| 503 Provider not configured | Missing env vars |
| Reminder `failed` / provider not configured | Empty `MSG91_*` in `.env` |
| WhatsApp 502 | Template name/namespace/language mismatch or unapproved template |
| SMS 502 | Sender ID / DLT template issues |
| Email 502 | Resend domain not verified / bad `EMAIL_FROM` |
| Eligible 0 | Missing phones/emails or marketing opt-out |
