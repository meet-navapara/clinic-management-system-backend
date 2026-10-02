/**
 * Seed 50 inbox (DoctorNotification) records for Demo-2 doctor.
 *
 *   node scripts/seed-demo2-fifty-inbox.mjs
 *   node scripts/seed-demo2-fifty-inbox.mjs --append   # add 50 more without deleting prior seed
 */
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import User from '../models/User.js';
import DoctorNotification from '../models/DoctorNotification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dns.setServers(['8.8.8.8', '1.1.1.1']);

const TEMPLATES = [
  {
    type: 'appointment_scheduled',
    title: 'New visit booked',
    body: (n) => `Demo patient #${n} booked a consultation.`,
    link: '/doctor/calendar',
  },
  {
    type: 'upcoming_appointment',
    title: 'Upcoming visit',
    body: (n) => `Visit #${n} is coming up soon — check the schedule.`,
    link: '/doctor/calendar',
  },
  {
    type: 'appointment_rescheduled',
    title: 'Visit rescheduled',
    body: (n) => `Appointment #${n} was moved to a new slot.`,
    link: '/doctor/calendar',
  },
  {
    type: 'appointment_cancelled',
    title: 'Visit cancelled',
    body: (n) => `Appointment #${n} was cancelled by the clinic.`,
    link: '/doctor/calendar',
  },
  {
    type: 'appointment_completed',
    title: 'Visit completed',
    body: (n) => `Consultation #${n} was marked completed.`,
    link: '/doctor/calendar',
  },
  {
    type: 'appointment_no_show',
    title: 'No-show recorded',
    body: (n) => `Patient for visit #${n} did not arrive.`,
    link: '/doctor/calendar',
  },
  {
    type: 'reminder_sent',
    title: 'Reminder delivered',
    body: (n) => `WhatsApp reminder #${n} was sent successfully.`,
    link: '/doctor/notifications',
  },
  {
    type: 'reminder_failed',
    title: 'Reminder failed',
    body: (n) => `WhatsApp reminder #${n} could not be delivered.`,
    link: '/doctor/notifications',
  },
  {
    type: 'patient_added',
    title: 'New patient registered',
    body: (n) => `Patient record #${n} was added to the clinic.`,
    link: '/doctor/patients',
  },
  {
    type: 'system',
    title: 'Clinic update',
    body: (n) => `System notice #${n}: review branch activity for today.`,
    link: '/doctor/dashboard',
  },
];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  const doctor =
    (await User.findOne({ role: 'doctor', approvalStatus: 'approved', name: /demo\s*2/i })) ||
    (await User.findOne({ role: 'doctor', approvalStatus: 'approved', email: /demo.?2/i }));
  if (!doctor) throw new Error('Demo 2 doctor not found');

  const TAG = '[demo2-inbox-seed]';
  const append = process.argv.includes('--append');

  let start = 1;
  if (append) {
    const max = await DoctorNotification.findOne({
      doctorId: doctor._id,
      'metadata.seedTag': TAG,
    })
      .sort({ 'metadata.seedIndex': -1 })
      .select('metadata');
    start = (max?.metadata?.seedIndex || 0) + 1;
  } else {
    const removed = await DoctorNotification.deleteMany({
      doctorId: doctor._id,
      'metadata.seedTag': TAG,
    });
    if (removed.deletedCount) {
      console.log(`Removed ${removed.deletedCount} previous Demo-2 inbox seed row(s).`);
    }
  }

  const now = Date.now();
  const docs = [];
  for (let i = start; i < start + 50; i += 1) {
    const tpl = TEMPLATES[(i - 1) % TEMPLATES.length];
    const createdAt = new Date(now - i * 45 * 60 * 1000);
    docs.push({
      doctorId: doctor._id,
      clinicId: doctor.clinicId || null,
      type: tpl.type,
      title: `${tpl.title} · ${i}`,
      body: tpl.body(i),
      link: tpl.link,
      // Mix unread / read for pagination testing
      readAt: i % 3 === 0 ? new Date(createdAt.getTime() + 10 * 60 * 1000) : null,
      metadata: { seedTag: TAG, seedIndex: i },
      createdAt,
      updatedAt: createdAt,
    });
  }

  await DoctorNotification.insertMany(docs);
  const total = await DoctorNotification.countDocuments({ doctorId: doctor._id });
  const unread = await DoctorNotification.countDocuments({ doctorId: doctor._id, readAt: null });

  console.log(`Doctor: ${doctor.name} <${doctor.email}>`);
  console.log(`Inserted 50 inbox notifications (#${start}–#${start + 49})${append ? ' (append)' : ''}.`);
  console.log(`Inbox total for this doctor: ${total} (${unread} unread)`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
