/**
 * Quick MSG91 WhatsApp connectivity check + optional real send.
 *
 *   node scripts/test-whatsapp-send.mjs
 *   node scripts/test-whatsapp-send.mjs 9876543210
 *
 * Without a phone: prints config status only (no send).
 * With a phone: sends one template message using MSG91_WHATSAPP_* from .env.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { getCommsConfigStatus, sendWhatsAppMessage } = await import('../utils/comms/providers.js');

const phoneArg = process.argv[2]?.trim();
const kindArg = String(process.argv[3] || 'confirmation').toLowerCase();
const templateKind = kindArg === 'reminder' ? 'reminder' : 'confirmation';
const status = getCommsConfigStatus().whatsapp;

console.log('\n=== WhatsApp (MSG91) config ===');
console.log('Configured:', status.configured);
console.log('Provider:', status.provider);
if (!status.configured) {
  console.log('Missing:', (status.missing || []).join(', ') || 'credentials');
  console.log('\nFill MSG91_AUTH_KEY, MSG91_WHATSAPP_NUMBER, MSG91_WHATSAPP_TEMPLATE_NAME in .env, restart, retry.\n');
  process.exit(1);
}

console.log('Confirmation template:', process.env.MSG91_WHATSAPP_TEMPLATE_NAME);
console.log(
  'Reminder template:',
  process.env.MSG91_WHATSAPP_REMINDER_TEMPLATE_NAME?.trim() || '(same as confirmation)'
);
console.log('Language:', process.env.MSG91_WHATSAPP_LANGUAGE || 'en');
console.log('Body vars:', process.env.MSG91_WHATSAPP_BODY_VARS || '(default)');
console.log('Integrated number set:', Boolean(process.env.MSG91_WHATSAPP_NUMBER?.trim()));

if (!phoneArg) {
  console.log('\nConfig OK. To send a real test message:');
  console.log('  node scripts/test-whatsapp-send.mjs <10-digit-mobile>');
  console.log('  node scripts/test-whatsapp-send.mjs <10-digit-mobile> reminder\n');
  console.log('Or in the app: Schedule → book visit → Reminders → Send WhatsApp\n');
  process.exit(0);
}

const context = {
  patientName: 'Test Patient',
  clinicName: 'Z Health Test Clinic',
  doctorName: 'Patel', // template already includes "Dr."
  dateLabel: new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
  timeSlot: '11:00',
};

console.log(`\nSending ${templateKind} template to`, phoneArg, '…');
try {
  const result = await sendWhatsAppMessage({
    toPhone: phoneArg,
    bodyText: 'Test appointment message',
    templateKind,
    context,
  });
  console.log('SUCCESS');
  console.log('Provider:', result.provider || 'msg91');
  console.log('Message ID:', result.providerMessageId || result.messageId || 'n/a');
  console.log('\nCheck WhatsApp on that phone. If nothing arrives, open MSG91 logs and confirm');
  console.log('template variable order matches MSG91_WHATSAPP_BODY_VARS.\n');
  process.exit(0);
} catch (err) {
  console.error('\nFAILED:', err.message);
  if (err.details) console.error('Details:', JSON.stringify(err.details, null, 2));
  console.error('\nCommon fixes:');
  console.error('- Template name must match MSG91 exactly (case-sensitive)');
  console.error('- Language code (en / en_US) must match approved template');
  console.error('- BODY_VARS order must match {{1}} {{2}} … in the template');
  console.error('- Recipient must be a valid WhatsApp number (India: 10 digits starting 6–9)\n');
  process.exit(1);
}
