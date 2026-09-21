# Campaign WhatsApp templates (per clinic)

Appointment confirmations still use global `.env` templates (`MSG91_WHATSAPP_TEMPLATE_NAME`).

**Campaigns never use the appointment template.** Flow:

1. **Doctor** (Campaigns page) submits template name + MSG91 body sample + body var order.
2. **Super Admin** opens Admin → **WA Templates**, creates the same template in MSG91, waits for Meta **Approved**.
3. Super Admin clicks **Approve for clinic** with the exact MSG91 template name.
4. That clinic can send WhatsApp campaigns; other clinics are unaffected.

Email campaigns still use Resend (`RESEND_API_KEY` / `EMAIL_FROM`).
