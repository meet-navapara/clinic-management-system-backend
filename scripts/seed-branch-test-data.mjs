/**
 * Seed branch-test patients for Dr. Demo 2 / Demo-2 branches.
 * Safe to re-run (skips by unique phone / demo notes).
 *
 *   node scripts/seed-branch-test-data.mjs
 */
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import Branch from '../models/Branch.js';
import User from '../models/User.js';
import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Consultation from '../models/Consultation.js';
import PatientEvent from '../models/PatientEvent.js';
import { nextSequence } from '../models/Counter.js';
import { generatePatientCode, deriveAge, splitName } from '../utils/patientHelpers.js';
import { computeInvoiceTotals, paymentStatusFromAmounts, roundMoney } from '../utils/money.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dns.setServers(['8.8.8.8', '1.1.1.1']);

const TAG = 'branch-test';
const NOTE = '[BRANCH-TEST]';

const day = (offset = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const pad = (n, size = 5) => String(n).padStart(size, '0');

async function nextInvoiceNumber(clinicId) {
  const seq = await nextSequence(`invoice:${clinicId}`);
  return `INV-${new Date().getFullYear()}-${pad(seq)}`;
}

async function nextReceiptNumber(clinicId) {
  const seq = await nextSequence(`receipt:${clinicId}`);
  return `RCP-${pad(seq)}`;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing in .env');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  // Prefer Demo-2 doctor / Main branch from the UI screenshot.
  let doctor =
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

  let branches = [];
  if (doctor?.clinicId) {
    branches = await Branch.find({ clinicId: doctor.clinicId, isActive: { $ne: false } }).sort({
      isDefault: -1,
      name: 1,
    });
  }

  if (!branches.length) {
    branches = await Branch.find({
      isActive: { $ne: false },
      $or: [{ name: /demo-2/i }, { name: /demo 2/i }],
    }).sort({ isDefault: -1, name: 1 });
  }

  if (!branches.length) {
    throw new Error('Could not find Demo-2 branches. Check branch names in the database.');
  }

  const clinicId = branches[0].clinicId;
  if (!doctor) {
    doctor = await User.findOne({
      clinicId,
      role: 'doctor',
      approvalStatus: 'approved',
      isActive: { $ne: false },
    }).sort({ createdAt: 1 });
  }
  if (!doctor) throw new Error('No approved doctor found for this clinic.');

  const main = branches.find((b) => b.isDefault) || branches[0];
  const second = branches.find((b) => /second/i.test(b.name)) || branches[1] || main;
  const third = branches.find((b) => /third/i.test(b.name)) || branches[2] || second;

  console.log(`Clinic: ${clinicId}`);
  console.log(`Doctor: ${doctor.name} <${doctor.email}>`);
  console.log(`Branches: ${branches.map((b) => b.name).join(' | ')}`);

  // 5 patients across 3 branches — different appointment + payment outcomes.
  const patientSpecs = [
    {
      name: 'Branch Test Asha',
      phone: '9000002001',
      gender: 'female',
      age: 32,
      branch: main,
      reason: 'Main branch — paid visit',
      appt: { offset: -2, slot: '09:30', status: 'completed', type: 'Consultation' },
      invoice: { status: 'paid', method: 'upi', fee: 700 },
    },
    {
      name: 'Branch Test Bharat',
      phone: '9000002002',
      gender: 'male',
      age: 45,
      branch: main,
      reason: 'Main branch — unpaid scheduled visit',
      appt: { offset: 0, slot: '11:00', status: 'confirmed', type: 'Consultation' },
      invoice: { status: 'unpaid', method: null, fee: 700 },
    },
    {
      name: 'Branch Test Chitra',
      phone: '9000002003',
      gender: 'female',
      age: 28,
      branch: second,
      reason: 'Second branch — partial payment',
      appt: { offset: -1, slot: '10:00', status: 'completed', type: 'Follow-up' },
      invoice: { status: 'partially_paid', method: 'cash', fee: 900 },
    },
    {
      name: 'Branch Test Deepak',
      phone: '9000002004',
      gender: 'male',
      age: 51,
      branch: second,
      reason: 'Second branch — cancelled slot',
      appt: { offset: 1, slot: '15:00', status: 'cancelled', type: 'Consultation' },
      invoice: null,
    },
    {
      name: 'Branch Test Esha',
      phone: '9000002005',
      gender: 'female',
      age: 39,
      branch: third,
      reason: 'Third branch — refunded bill + no-show history',
      appt: { offset: -5, slot: '16:00', status: 'no_show', type: 'Consultation' },
      invoice: { status: 'refunded', method: 'card', fee: 800 },
      extraAppt: { offset: 0, slot: '14:00', status: 'scheduled', type: 'Follow-up' },
    },
  ];

  const counts = { patients: 0, appointments: 0, consultations: 0, invoices: 0, payments: 0 };
  const createdPatients = [];

  for (const spec of patientSpecs) {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - spec.age);
    dob.setMonth(5);
    dob.setDate(15);
    const { firstName, lastName } = splitName(spec.name);

    let patient = await Patient.findOne({ clinicId, phone: spec.phone });
    if (!patient) {
      patient = await Patient.create({
        clinicId,
        doctorId: doctor._id,
        branchId: spec.branch._id,
        tags: [TAG, String(spec.branch.name).toLowerCase().replace(/\s+/g, '-')],
        patientCode: await generatePatientCode(),
        firstName,
        lastName,
        name: spec.name,
        phone: spec.phone,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@branch-test.local`,
        dateOfBirth: dob,
        age: deriveAge(dob) || spec.age,
        gender: spec.gender,
        address: `Test flat, ${spec.branch.name}`,
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        emergencyContact: { name: 'Family', relationship: 'Spouse', phone: '9000002099' },
        clinical: {
          allergies: [],
          conditions: [],
          medications: [],
          medicalHistory: '',
          familyHistory: '',
          surgeries: '',
          alerts: [],
        },
        notes: `${NOTE} ${spec.reason}`,
        isActive: true,
      });
      counts.patients += 1;
      await PatientEvent.create({
        clinicId,
        doctorId: doctor._id,
        patientId: patient._id,
        type: 'patient_created',
        title: 'Patient registered',
        detail: `${NOTE} ${spec.branch.name}`,
      });
    } else {
      // Keep branch assignment correct if re-run after move.
      if (String(patient.branchId) !== String(spec.branch._id)) {
        patient.branchId = spec.branch._id;
        await patient.save();
      }
    }
    createdPatients.push({ patient, spec });

    const apptPlans = [spec.appt, spec.extraAppt].filter(Boolean);
    let primaryAppt = null;

    for (const plan of apptPlans) {
      const appointmentDate = day(plan.offset);
      let appt = await Appointment.findOne({
        doctor: doctor._id,
        appointmentDate,
        timeSlot: plan.slot,
        notes: NOTE,
      });
      if (!appt) {
        try {
          appt = await Appointment.create({
            clinicId,
            branchId: spec.branch._id,
            patientId: patient._id,
            doctor: doctor._id,
            appointmentDate,
            timeSlot: plan.slot,
            durationMinutes: 30,
            appointmentType: plan.type,
            reason: spec.reason,
            status: plan.status,
            notes: NOTE,
            reminderScheduled: plan.offset >= 0 && !['cancelled', 'no_show'].includes(plan.status),
          });
          counts.appointments += 1;
          await PatientEvent.create({
            clinicId,
            doctorId: doctor._id,
            patientId: patient._id,
            appointmentId: appt._id,
            type:
              plan.status === 'completed'
                ? 'appointment_completed'
                : plan.status === 'cancelled'
                  ? 'appointment_cancelled'
                  : plan.status === 'no_show'
                    ? 'appointment_no_show'
                    : 'appointment_scheduled',
            title: `Appointment ${plan.status}`,
            detail: `${plan.slot} · ${spec.branch.name}`,
          });
        } catch (err) {
          console.warn(`Skip appt ${plan.slot}: ${err.message}`);
          continue;
        }
      }
      if (!primaryAppt) primaryAppt = appt;

      if (plan.status === 'completed') {
        const existingConsult = await Consultation.findOne({ appointmentId: appt._id });
        if (!existingConsult) {
          await Consultation.create({
            clinicId,
            branchId: spec.branch._id,
            doctorId: doctor._id,
            patientId: patient._id,
            appointmentId: appt._id,
            chiefComplaint: spec.reason,
            symptoms: 'Mild discomfort for a few days.',
            observation: 'Stable vitals. No acute distress.',
            diagnosis: 'General wellness review',
            treatment: 'Lifestyle advice and follow-up.',
            advice: 'Hydration, light meals, rest.',
            followUp: 'Review in 14 days',
            vitals: { bp: '120/80', pulse: '72', temperature: '98.4 F', weight: '65', spo2: '98' },
            status: 'completed',
            completedAt: appointmentDate,
          });
          counts.consultations += 1;
        }
      }
    }

    if (!spec.invoice) continue;

    const invNote = `${NOTE} ${spec.invoice.status}`;
    const existingInv = await Invoice.findOne({ clinicId, patientId: patient._id, notes: invNote });
    if (existingInv) continue;

    const fee = spec.invoice.fee || 700;
    const rawItems = [
      { type: 'consultation', name: 'Consultation fee', quantity: 1, unitPrice: fee, discount: 0 },
    ];
    if (spec.invoice.status === 'partially_paid') {
      rawItems.push({ type: 'procedure', name: 'Therapy session', quantity: 1, unitPrice: 500, discount: 0 });
    }
    const totals = computeInvoiceTotals({
      items: rawItems,
      discount: spec.invoice.status === 'partially_paid' ? 50 : 0,
      taxRate: 5,
    });

    let paidAmount = 0;
    if (spec.invoice.status === 'paid' || spec.invoice.status === 'refunded') paidAmount = totals.total;
    if (spec.invoice.status === 'partially_paid') paidAmount = roundMoney(totals.total * 0.4);
    const refundedAmount = spec.invoice.status === 'refunded' ? totals.total : 0;
    const derived = paymentStatusFromAmounts(totals.total, paidAmount, refundedAmount);

    const invoice = await Invoice.create({
      invoiceNumber: await nextInvoiceNumber(clinicId),
      clinicId,
      branchId: spec.branch._id,
      patientId: patient._id,
      doctorId: doctor._id,
      appointmentId: primaryAppt?._id || null,
      items: totals.items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxRate: 5,
      tax: totals.tax,
      total: totals.total,
      paidAmount: derived.paidAmount,
      refundedAmount,
      dueAmount: derived.dueAmount,
      paymentStatus: derived.paymentStatus,
      invoiceDate: primaryAppt?.appointmentDate || day(-1),
      notes: invNote,
      createdBy: doctor._id,
    });
    counts.invoices += 1;

    if (paidAmount > 0) {
      const pay = await Payment.create({
        invoiceId: invoice._id,
        clinicId,
        branchId: spec.branch._id,
        amount: paidAmount,
        paymentMethod: spec.invoice.method || 'cash',
        transactionReference: spec.invoice.method === 'upi' ? 'UPI-BRANCH-TEST' : '',
        paymentDate: invoice.invoiceDate,
        receivedBy: doctor._id,
        status: 'completed',
        receiptNumber: await nextReceiptNumber(clinicId),
        notes: `${NOTE} payment`,
      });
      counts.payments += 1;

      if (spec.invoice.status === 'refunded') {
        await Payment.create({
          invoiceId: invoice._id,
          clinicId,
          branchId: spec.branch._id,
          amount: refundedAmount,
          paymentMethod: spec.invoice.method || 'card',
          paymentDate: day(-3),
          receivedBy: doctor._id,
          status: 'refunded',
          receiptNumber: await nextReceiptNumber(clinicId),
          notes: `${NOTE} refund`,
          refundOf: pay._id,
        });
        counts.payments += 1;
      }

      await PatientEvent.create({
        clinicId,
        doctorId: doctor._id,
        patientId: patient._id,
        type: 'payment_received',
        title: spec.invoice.status === 'refunded' ? 'Payment refunded' : 'Payment received',
        detail: `${invoice.invoiceNumber} · ₹${paidAmount} · ${spec.branch.name}`,
      });
    } else {
      await PatientEvent.create({
        clinicId,
        doctorId: doctor._id,
        patientId: patient._id,
        type: 'invoice_created',
        title: 'Invoice created',
        detail: `${invoice.invoiceNumber} · unpaid · ${spec.branch.name}`,
      });
    }
  }

  console.log('\nBranch test data ready.');
  console.log('Created this run:', JSON.stringify(counts, null, 2));
  console.log('\nPatients by branch:');
  for (const { patient, spec } of createdPatients) {
    console.log(
      `  ${spec.branch.name.padEnd(22)} ${patient.name} · ${patient.phone} · appt=${spec.appt.status}` +
        (spec.invoice ? ` · bill=${spec.invoice.status}` : ' · no bill')
    );
  }
  console.log('\nIn the app: switch All branches / Main / Second / Third and check Patients, Calendar, Billing, Revenue.\n');

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
