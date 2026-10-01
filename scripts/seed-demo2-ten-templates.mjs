/**
 * Ensure Demo-2 clinic has exactly 10 templates across Main / Second / Third.
 *
 *   node scripts/seed-demo2-ten-templates.mjs
 */
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import Branch from '../models/Branch.js';
import User from '../models/User.js';
import ClinicalTemplate from '../models/ClinicalTemplate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dns.setServers(['8.8.8.8', '1.1.1.1']);

const PLAN = [
  // Main — 4
  {
    branchKey: 'main',
    name: 'Main · General consultation',
    type: 'consultation',
    ownerType: 'clinic',
    fields: {
      chiefComplaint: 'General wellness / checkup.',
      symptoms: 'As reported by patient.',
      observation: 'General physical exam.',
      diagnosis: 'Clinical impression as documented.',
      treatment: 'Supportive care and lifestyle advice.',
      advice: 'Hydration, regular meals, adequate sleep.',
      followUp: 'As needed or in 2 weeks.',
      instructions: 'Follow prescribed plan carefully.',
    },
  },
  {
    branchKey: 'main',
    name: 'Main · Fever / infection screen',
    type: 'consultation',
    ownerType: 'clinic',
    fields: {
      chiefComplaint: 'Fever / body ache / sore throat.',
      symptoms: 'Onset, peak temperature, associated symptoms.',
      observation: 'Vitals; throat/chest exam.',
      diagnosis: 'Viral / bacterial suspicion — document.',
      treatment: 'Rest, fluids, antipyretic as advised.',
      advice: 'Isolate if contagious; monitor hydration.',
      followUp: 'Return if fever persists beyond 48–72h.',
      instructions: 'Do not combine fever medicines without advice.',
    },
  },
  {
    branchKey: 'main',
    name: 'Main · Rx standard notes',
    type: 'prescription_instructions',
    ownerType: 'clinic',
    fields: {
      instructions: 'Take after food with warm water unless noted.',
      advice: 'Complete the course.',
      followUp: 'Contact clinic if side effects appear.',
    },
  },
  {
    branchKey: 'main',
    name: 'Main · Follow-up checklist',
    type: 'followup_instructions',
    ownerType: 'clinic',
    fields: {
      chiefComplaint: 'Scheduled follow-up.',
      symptoms: 'Compare with last visit notes.',
      observation: 'Reassess key findings.',
      diagnosis: 'Progress / stable / worsened.',
      treatment: 'Continue, step down, or escalate.',
      advice: 'Reinforce lifestyle points.',
      followUp: 'Next review date.',
      instructions: 'Bring previous reports if any.',
    },
  },
  // Second — 3
  {
    branchKey: 'second',
    name: 'Second · Follow-up review',
    type: 'followup_instructions',
    ownerType: 'clinic',
    fields: {
      chiefComplaint: 'Follow-up after prior visit at Second branch.',
      symptoms: 'Review residual symptoms and adherence.',
      observation: 'General exam; vitals as recorded.',
      diagnosis: 'Stable / improving on plan.',
      treatment: 'Continue current medicines; adjust if needed.',
      advice: 'Warm meals, early sleep, light walk.',
      followUp: 'Return in 14 days or earlier if worse.',
      instructions: 'Do not stop medicines without advice.',
    },
  },
  {
    branchKey: 'second',
    name: 'Second · Digestive consult',
    type: 'consultation',
    ownerType: 'clinic',
    fields: {
      chiefComplaint: 'Acidity / bloating / irregular digestion.',
      symptoms: 'Post-meal heaviness, gas, occasional reflux.',
      observation: 'Abdomen soft; no acute tenderness.',
      diagnosis: 'Digestive imbalance (agnimandya).',
      treatment: 'Deepana-pachana; light diet protocol.',
      advice: 'Avoid late dinners, cold drinks, fried food.',
      followUp: 'Review in 7–10 days.',
      instructions: 'Take prescribed remedies after food.',
    },
  },
  {
    branchKey: 'second',
    name: 'Second · Rx notes (standard)',
    type: 'prescription_instructions',
    ownerType: 'clinic',
    fields: {
      instructions: 'Take after food with warm water unless noted. Store away from moisture.',
      advice: 'Complete the full course.',
      followUp: 'Message the clinic if rash or severe stomach upset.',
    },
  },
  // Third — 3
  {
    branchKey: 'third',
    name: 'Third · Skin flare consult',
    type: 'consultation',
    ownerType: 'clinic',
    fields: {
      chiefComplaint: 'Itching / rash / skin flare.',
      symptoms: 'Localized itching, dryness, occasional redness.',
      observation: 'Skin inspection; note area and severity.',
      diagnosis: 'Dermatitis / dry skin tendency.',
      treatment: 'External oil/cream + oral support as indicated.',
      advice: 'Avoid hot showers, harsh soaps; keep skin moisturized.',
      followUp: 'Review in 10 days.',
      instructions: 'Apply thin layer twice daily on clean skin.',
    },
  },
  {
    branchKey: 'third',
    name: 'Third · Joint pain protocol',
    type: 'treatment',
    ownerType: 'clinic',
    fields: {
      chiefComplaint: 'Joint stiffness or pain.',
      symptoms: 'Morning stiffness, activity-related discomfort.',
      observation: 'Range of motion; local warmth if any.',
      diagnosis: 'Vata-dominant joint discomfort.',
      treatment: 'Local abhyanga / fomentation advice; oral support.',
      advice: 'Warm compress; avoid cold exposure of joints.',
      followUp: 'Review in 2 weeks.',
      instructions: 'Gentle mobility; stop if pain spikes sharply.',
    },
  },
  {
    branchKey: 'third',
    name: 'Third · Diagnosis note',
    type: 'diagnosis',
    ownerType: 'clinic',
    fields: {
      diagnosis: 'Working diagnosis — refine after labs if ordered.',
      observation: 'Document key positives/negatives.',
      advice: 'Explain plan in simple language before discharge.',
    },
  },
];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  const doctor =
    (await User.findOne({ role: 'doctor', approvalStatus: 'approved', name: /demo\s*2/i })) ||
    (await User.findOne({ role: 'doctor', approvalStatus: 'approved', email: /demo.?2/i }));
  if (!doctor) throw new Error('Demo 2 doctor not found');

  const clinicId = doctor.clinicId;
  const branches = await Branch.find({ clinicId }).sort({ isDefault: -1, name: 1 });
  const main = branches.find((b) => b.isDefault) || branches[0];
  const second = branches.find((b) => /second/i.test(b.name));
  const third = branches.find((b) => /third/i.test(b.name));
  if (!main || !second || !third) {
    throw new Error(`Need Main/Second/Third. Have: ${branches.map((b) => b.name).join(', ')}`);
  }

  const byKey = { main, second, third };

  // Remove all existing templates for this clinic, then install the exact 10.
  const deleted = await ClinicalTemplate.deleteMany({ clinicId });
  console.log(`Removed ${deleted.deletedCount} existing template(s) for Demo-2 clinic.`);

  let created = 0;
  for (const item of PLAN) {
    const branch = byKey[item.branchKey];
    await ClinicalTemplate.create({
      clinicId,
      branchId: branch._id,
      doctorId: item.ownerType === 'doctor' ? doctor._id : null,
      ownerType: item.ownerType,
      type: item.type,
      name: item.name,
      fields: item.fields,
      isActive: true,
    });
    created += 1;
    console.log(`+ ${branch.name} · ${item.name}`);
  }

  const total = await ClinicalTemplate.countDocuments({ clinicId });
  console.log(`\nTotal templates for Demo-2: ${total} (created ${created})`);
  for (const b of [main, second, third]) {
    const n = await ClinicalTemplate.countDocuments({ clinicId, branchId: b._id });
    console.log(`  ${b.name}: ${n}`);
  }

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
