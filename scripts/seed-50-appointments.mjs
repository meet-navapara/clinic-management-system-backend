/**
 * Seed 50 test appointments (frontend pagination testing).
 *
 * Run from project root:
 *   node backend/scripts/seed-50-appointments.mjs
 *
 * Or paste the mongosh block below into MongoDB Compass → mongosh (select your DB first).
 */

import dns from 'dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dns.setServers(['8.8.8.8', '1.1.1.1']);

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const TIME_SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
const REASONS = [
  'General Ayurvedic consultation',
  'Panchakarma detox therapy',
  'Chronic joint pain relief',
  'Digestive health assessment',
  'Stress and sleep management',
  'Skin allergy follow-up',
  'Migraine and headache care',
  'Post-treatment review',
  'Weight management guidance',
  'Seasonal wellness checkup',
];

function buildAppointments(doctorId, patientIds) {
  const now = new Date();
  const docs = [];

  for (let i = 0; i < 50; i += 1) {
    const dayOffset = Math.floor(i / TIME_SLOTS.length);
    const appointmentDate = new Date(now);
    appointmentDate.setDate(appointmentDate.getDate() + dayOffset);
    appointmentDate.setHours(0, 0, 0, 0);

    docs.push({
      patient: patientIds[i % patientIds.length],
      doctor: doctorId,
      appointmentDate,
      timeSlot: TIME_SLOTS[i % TIME_SLOTS.length],
      reason: REASONS[i % REASONS.length],
      status: STATUSES[i % STATUSES.length],
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return docs;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const doctor = await db.collection('users').findOne({ role: 'doctor', isActive: { $ne: false } });
  if (!doctor) {
    throw new Error('No doctor found. Register a doctor first via /admin/register or seed.js');
  }

  let patients = await db.collection('users').find({ role: 'patient' }).limit(10).toArray();
  if (patients.length === 0) {
    throw new Error('No patients found. Register at least one patient via /register first.');
  }

  const patientIds = patients.map((p) => p._id);
  const appointments = buildAppointments(doctor._id, patientIds);

  const result = await db.collection('appointments').insertMany(appointments);
  console.log(`Inserted ${result.insertedCount} appointments.`);
  console.log(`Doctor: ${doctor.name} (${doctor.email})`);
  console.log(`Patients used: ${patientIds.length}`);
  console.log('Statuses: pending, confirmed, completed, cancelled (rotating)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
