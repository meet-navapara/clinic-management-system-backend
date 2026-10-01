/**
 * Seed clinical templates for Demo-2 Second & Third branches.
 *
 *   node scripts/seed-branch-templates.mjs
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

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  const doctor =
    (await User.findOne({
      role: 'doctor',
      approvalStatus: 'approved',
      name: /demo\s*2/i,
      isActive: { $ne: false },
    })) ||
    (await User.findOne({
      role: 'doctor',
      approvalStatus: 'approved',
      email: /demo.?2/i,
      isActive: { $ne: false },
    }));
  if (!doctor) throw new Error('Demo 2 doctor not found');

  const clinicId = doctor.clinicId;
  const branches = await Branch.find({ clinicId, isActive: { $ne: false } }).sort({
    isDefault: -1,
    name: 1,
  });
  const second = branches.find((b) => /second/i.test(b.name));
  const third = branches.find((b) => /third/i.test(b.name));
  if (!second || !third) {
    throw new Error(`Second/Third not found. Have: ${branches.map((b) => b.name).join(', ')}`);
  }

  const specs = [
    {
      branch: second,
      items: [
        {
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
          name: 'Second · Rx notes (standard)',
          type: 'prescription_instructions',
          ownerType: 'doctor',
          doctorId: doctor._id,
          fields: {
            instructions:
              'Take after food with warm water unless noted. Store away from moisture.',
            advice: 'Complete the full course.',
            followUp: 'Message the clinic if rash or severe stomach upset.',
          },
        },
      ],
    },
    {
      branch: third,
      items: [
        {
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
          name: 'Third · Dr. Demo private note',
          type: 'diagnosis',
          ownerType: 'doctor',
          doctorId: doctor._id,
          fields: {
            diagnosis: 'Working diagnosis — refine after labs if ordered.',
            observation: 'Document key positives/negatives.',
            advice: 'Explain plan in simple language before discharge.',
          },
        },
      ],
    },
  ];

  let created = 0;
  for (const group of specs) {
    for (const item of group.items) {
      const existing = await ClinicalTemplate.findOne({
        clinicId,
        branchId: group.branch._id,
        name: item.name,
      });
      if (existing) {
        console.log('skip', group.branch.name, '·', item.name);
        continue;
      }
      await ClinicalTemplate.create({
        clinicId,
        branchId: group.branch._id,
        doctorId: item.doctorId || null,
        ownerType: item.ownerType,
        type: item.type,
        name: item.name,
        fields: item.fields,
        isActive: true,
      });
      created += 1;
      console.log('created', group.branch.name, '·', item.name);
    }
  }

  console.log(`\nDone. Created ${created} templates.`);
  console.log(`Second: ${second.name}`);
  console.log(`Third: ${third.name}`);
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
