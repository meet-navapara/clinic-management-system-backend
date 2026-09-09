/**
 * Builds a WhatsApp redirect URL with pre-filled appointment details.
 * Uses wa.me format — works on mobile and desktop (opens WhatsApp Web).
 *
 * audience:
 *   'doctor' → message is addressed to the patient (doctor notifying patient);
 *              the chat opens to the patient's phone.
 *   'clinic' → message is addressed to the clinic (patient contacting clinic);
 *              the chat opens to the clinic number.
 */

const DEFAULT_CLINIC_NUMBER = '919876543210';

const formatDoctorName = (name) => {
  if (!name) return 'Doctor unavailable';
  const trimmed = name.trim();
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
};

const normalizePhone = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  // Already includes a country code (more than 10 digits) — use as-is.
  if (digits.length > 10) return digits;
  // Assume a 10-digit Indian mobile number and prepend the country code.
  return `91${digits}`;
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Date unavailable';

const buildContext = (appointment, patient, doctor) => ({
  status: appointment?.status ?? 'pending',
  patientName: patient?.name ?? 'Patient',
  patientPhone: patient?.phone ?? '—',
  patientEmail: patient?.email ?? '—',
  doctorName: formatDoctorName(doctor?.name),
  specialization: doctor?.specialization ?? '—',
  date: formatDate(appointment?.appointmentDate),
  time: appointment?.timeSlot ?? '—',
  reason: appointment?.reason ?? '—',
});

const HEADER = '🌿 *Shreeshakti Ayurveda*';

const patientDetailsBlock = (ctx) => [
  `*Patient:* ${ctx.patientName}`,
  `*Phone:* ${ctx.patientPhone}`,
  `*Email:* ${ctx.patientEmail}`,
  '',
  `*Doctor:* ${ctx.doctorName}`,
  `*Specialization:* ${ctx.specialization}`,
];

const doctorTemplates = {
  confirmed: (ctx) => [
    HEADER,
    '',
    `Dear ${ctx.patientName}, your appointment is *CONFIRMED* `,
    '',
    ...patientDetailsBlock(ctx),
    '',
    `*Date:* ${ctx.date}`,
    `*Time:* ${ctx.time}`,
    '',
    'Please arrive 10 minutes early.',
  ],
  completed: (ctx) => [
    HEADER,
    '',
    `Dear ${ctx.patientName}, thank you for visiting *${ctx.doctorName}* `,
    '',
    ...patientDetailsBlock(ctx),
    '',
    `Your consultation on ${ctx.date} at ${ctx.time} is now *COMPLETED*.`,
    'Wishing you good health.',
  ],
  cancelled: (ctx) => [
    HEADER,
    '',
    `Dear ${ctx.patientName}, your appointment has been *CANCELLED* `,
    '',
    ...patientDetailsBlock(ctx),
    '',
    `*Date:* ${ctx.date}`,
    `*Time:* ${ctx.time}`,
    '',
    'Apologies for the inconvenience.',
  ],
  pending: (ctx) => [
    HEADER,
    '',
    `Dear ${ctx.patientName}, we've received your appointment request `,
    '',
    ...patientDetailsBlock(ctx),
    '',
    `*Date:* ${ctx.date}`,
    `*Time:* ${ctx.time}`,
    `*Reason:* ${ctx.reason}`,
    '*Status:* Awaiting confirmation',
    '',
    "We'll notify you once it's confirmed.",
  ],
};

const patientTemplates = {
  pending: (ctx) => [
    HEADER,
    '',
    "Hello, I'd like to *book an appointment* ",
    '',
    ...patientDetailsBlock(ctx),
    '',
    `*Date:* ${ctx.date}`,
    `*Time:* ${ctx.time}`,
    `*Reason:* ${ctx.reason}`,
    '',
    'Please confirm my appointment.',
  ],
  confirmed: (ctx) => [
    HEADER,
    '',
    `Hello ${ctx.doctorName}, thank you for *CONFIRMED* my appointment `,
    '',
    ...patientDetailsBlock(ctx),
    '',
    `*Date:* ${ctx.date}`,
    `*Time:* ${ctx.time}`,
    '',
    'Thank you, See you then.',
  ],
  completed: (ctx) => [
    HEADER,
    '',
    'Hello, thank you for the consultation ',
    '', 
    ...patientDetailsBlock(ctx),
    '',
    `*Date:* ${ctx.date}`,
    `*Time:* ${ctx.time}`,
    '',
    'My appointment is now *COMPLETED*.',
  ],
  cancelled: (ctx) => [
    HEADER,
    '',
    'Hello, I need to *CANCEL* my appointment ',
    '',
    ...patientDetailsBlock(ctx),
    '',
    `*Date:* ${ctx.date}`,
    `*Time:* ${ctx.time}`,
    '',
    'Sorry for the inconvenience.',
  ],
};

export const buildWhatsAppUrl = (appointment, patient, doctor, audience = 'clinic') => {
  const ctx = buildContext(appointment, patient, doctor);
  const clinicNumber = process.env.WHATSAPP_CLINIC_NUMBER || DEFAULT_CLINIC_NUMBER;

  let recipient;
  let message;

  if (audience === 'doctor') {
    const template = doctorTemplates[ctx.status] || doctorTemplates.pending;
    message = template(ctx).join('\n');
    recipient = normalizePhone(ctx.patientPhone) || clinicNumber;
  } else {
    const template = patientTemplates[ctx.status] || patientTemplates.pending;
    message = template(ctx).join('\n');
    recipient = clinicNumber;
  }

  const encoded = encodeURIComponent(message);
  return `https://wa.me/${recipient}?text=${encoded}`;
};
