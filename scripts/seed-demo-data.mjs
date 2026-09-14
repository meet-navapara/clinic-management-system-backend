/**
 * Additive demo data for every clinic section.
 * Safe to re-run: upserts by unique demo keys, never deletes live records.
 *
 *   node scripts/seed-demo-data.mjs
 *
 * Demo staff password: Demo@123
 */
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import Clinic from '../models/Clinic.js';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Medicine from '../models/Medicine.js';
import InventoryLot from '../models/InventoryLot.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import ClinicalTemplate from '../models/ClinicalTemplate.js';
import Consultation from '../models/Consultation.js';
import Prescription from '../models/Prescription.js';
import ConsentTemplate from '../models/ConsentTemplate.js';
import ConsentRecord from '../models/ConsentRecord.js';
import QueueTicket from '../models/QueueTicket.js';
import Campaign from '../models/Campaign.js';
import CampaignDelivery from '../models/CampaignDelivery.js';
import PrintSettings from '../models/PrintSettings.js';
import PatientNote from '../models/PatientNote.js';
import PatientEvent from '../models/PatientEvent.js';
import NotificationLog from '../models/NotificationLog.js';
import DoctorNotification from '../models/DoctorNotification.js';
import AuditLog from '../models/AuditLog.js';
import { nextSequence } from '../models/Counter.js';
import { generatePatientCode, deriveAge, splitName } from '../utils/patientHelpers.js';
import { computeInvoiceTotals, paymentStatusFromAmounts, roundMoney } from '../utils/money.js';
import { seedClinicTemplates } from '../utils/migrateV2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dns.setServers(['8.8.8.8', '1.1.1.1']);

const DEMO_PASSWORD = 'Demo@123';
const TAG = 'demo';
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAABkCAYAAAC4t7qUAAAAhUlEQVR4nO3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBuF4sAAee1B9kAAAAASUVORK5CYII=';

const day = (offset = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const at = (offset, hour, minute = 0) => {
  const d = day(offset);
  d.setHours(hour, minute, 0, 0);
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

async function ensure(Model, filter, data, { update = false } = {}) {
  let doc = await Model.findOne(filter);
  if (doc) {
    if (update) {
      Object.assign(doc, data);
      await doc.save();
    }
    return { doc, created: false };
  }
  doc = await Model.create(data);
  return { doc, created: true };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing in clinic-backend/.env');
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const counts = {};

  const clinic = await Clinic.findOne({ isActive: { $ne: false } }).sort({ createdAt: 1 });
  if (!clinic) throw new Error('No clinic found. Register a doctor first.');

  const admin = await User.findOne({
    clinicId: clinic._id,
    role: 'doctor',
    approvalStatus: 'approved',
    isActive: { $ne: false },
  }).sort({ createdAt: 1 });
  if (!admin) throw new Error('No approved doctor found for this clinic.');

  let doctor = await User.findOne({
    clinicId: clinic._id,
    role: 'doctor',
    approvalStatus: 'approved',
    isActive: { $ne: false },
  }).sort({ createdAt: 1 });

  clinic.gstNumber = clinic.gstNumber || '27AABCU9603R1ZX';
  clinic.registrationNumber = clinic.registrationNumber || 'AYUSH-MH-2018-4421';
  clinic.taxEnabled = true;
  clinic.taxRate = clinic.taxRate || 5;
  clinic.website = clinic.website || 'https://shreeshakti.example';
  clinic.whatsappNumber = clinic.whatsappNumber || clinic.phone || '9876500000';
  clinic.expiryWarningDays = 60;
  await clinic.save();

  const mainBranch =
    (await Branch.findOne({ clinicId: clinic._id, isDefault: true })) ||
    (await Branch.findOne({ clinicId: clinic._id }).sort({ createdAt: 1 }));
  if (!mainBranch) throw new Error('No branch found. Restart the backend once so V2 migration can create Main.');

  mainBranch.tokenPrefix = mainBranch.tokenPrefix || 'A';
  mainBranch.roomLabel = mainBranch.roomLabel || 'Consult 1';
  mainBranch.displayTitle = mainBranch.displayTitle || `${clinic.name} — Main`;
  mainBranch.phone = mainBranch.phone || clinic.phone || '022-4001-1100';
  mainBranch.email = mainBranch.email || clinic.email || admin.email;
  await mainBranch.save();

  const west = await ensure(
    Branch,
    { clinicId: clinic._id, code: 'WEST' },
    {
      clinicId: clinic._id,
      name: 'Andheri West',
      code: 'WEST',
      address: '12, SV Road, Andheri West, Mumbai 400058',
      phone: '022-4001-2200',
      email: 'andheri@shreeshakti.example',
      isDefault: false,
      isActive: true,
      displayTitle: `${clinic.name} — Andheri`,
      roomLabel: 'Consult 2',
      tokenPrefix: 'B',
    }
  );
  counts.branches = west.created ? 1 : 0;
  const westBranch = west.doc;

  const staffSpecs = [
    {
      email: 'meera.manager@demo.shreeshakti.local',
      name: 'Meera Iyer',
      role: 'clinic_manager',
      phone: '9876501001',
      customRoleName: '',
    },
    {
      email: 'anita.desk@demo.shreeshakti.local',
      name: 'Anita Desai',
      role: 'receptionist',
      phone: '9876501002',
    },
    {
      email: 'kavita.nurse@demo.shreeshakti.local',
      name: 'Kavita More',
      role: 'nurse',
      phone: '9876501003',
    },
    {
      email: 'ravi.assist@demo.shreeshakti.local',
      name: 'Ravi Kulkarni',
      role: 'assistant',
      phone: '9876501004',
    },
    {
      email: 'dr.arjun@demo.shreeshakti.local',
      name: 'Dr. Arjun Mehta',
      role: 'doctor',
      phone: '9876501005',
      specialization: 'Panchakarma',
      qualification: 'BAMS, MD (Kayachikitsa)',
      experience: 11,
      consultationFee: 800,
      approvalStatus: 'approved',
      availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    },
    {
      email: 'dr.pending@demo.shreeshakti.local',
      name: 'Dr. Nisha Rao',
      role: 'doctor',
      phone: '9876501006',
      specialization: 'Kayachikitsa',
      qualification: 'BAMS',
      experience: 4,
      consultationFee: 600,
      approvalStatus: 'pending',
      isActive: true,
    },
  ];

  counts.staff = 0;
  const staffByRole = {};
  for (const spec of staffSpecs) {
    const { doc, created } = await ensure(
      User,
      { email: spec.email },
      {
        ...spec,
        password: DEMO_PASSWORD,
        clinicId: clinic._id,
        clinicName: clinic.name,
        branchIds: [mainBranch._id, westBranch._id],
        defaultBranchId: spec.role === 'doctor' && spec.email.includes('arjun') ? westBranch._id : mainBranch._id,
        staffStatus: 'active',
        isActive: spec.isActive !== false,
        approvalStatus: spec.approvalStatus || 'approved',
        joiningDate: day(-120),
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
      }
    );
    if (created) counts.staff += 1;
    staffByRole[spec.email] = doc;
  }

  const doctor2 = staffByRole['dr.arjun@demo.shreeshakti.local'];
  if (!doctor) doctor = doctor2;

  await User.updateMany(
    { clinicId: clinic._id, _id: { $in: [admin._id, doctor._id, doctor2._id] } },
    { $addToSet: { branchIds: { $each: [mainBranch._id, westBranch._id] } } }
  );
  if (!admin.defaultBranchId) {
    admin.defaultBranchId = mainBranch._id;
    await admin.save();
  }

  await seedClinicTemplates(clinic._id);
  await ensure(
    ClinicalTemplate,
    { clinicId: clinic._id, name: 'Panchakarma intake', ownerType: 'doctor', doctorId: doctor._id },
    {
      clinicId: clinic._id,
      doctorId: doctor._id,
      ownerType: 'doctor',
      type: 'consultation',
      name: 'Panchakarma intake',
      isActive: true,
      fields: {
        chiefComplaint: 'Seeking Panchakarma for ',
        symptoms: 'Chronic fatigue, heaviness, irregular digestion.',
        observation: 'Nadi: vata-pitta. Tongue coated.',
        diagnosis: 'Vata-pitta imbalance with ama.',
        treatment: 'Deepana-pachana 5 days, then snehana and swedana.',
        advice: 'Warm, light diet. Avoid cold drinks and late nights.',
        followUp: 'Review on day 6 before snehapana.',
        instructions: '',
      },
    }
  );

  await PrintSettings.findOneAndUpdate(
    { clinicId: clinic._id },
    {
      $set: {
        clinicName: clinic.name,
        address: clinic.address || 'Shreeshakti Ayurveda, Mumbai',
        phone: clinic.phone || mainBranch.phone,
        email: clinic.email || admin.email,
        website: clinic.website,
        registrationNumber: clinic.registrationNumber,
        gstNumber: clinic.gstNumber,
        taxLabel: 'GST',
        headerText: 'Authentic Ayurvedic care',
        footerText: 'Get well soon. For emergencies call the clinic number above.',
        terms: 'Medicines once dispensed cannot be returned. Follow the prescribed diet and rest.',
        showSignature: true,
        signatureLabel: 'Doctor signature',
        paperSize: 'A4',
        currency: 'INR',
        currencySymbol: '₹',
      },
    },
    { upsert: true }
  );

  const medicineSpecs = [
    { name: 'Ashwagandha', genericName: 'Withania somnifera', strength: '500 mg', dosageForm: 'capsule', sellingPrice: 280, purchasePrice: 160, minimumStockLevel: 20, category: 'Rasayana', unit: 'bottle', defaultDosage: '1 capsule', defaultFrequency: 'twice daily', defaultDuration: '30 days', manufacturer: 'Shreeshakti Pharmacy' },
    { name: 'Triphala churna', genericName: 'Triphala', strength: '100 g', dosageForm: 'powder', sellingPrice: 180, purchasePrice: 90, minimumStockLevel: 15, category: 'Digestive', unit: 'jar', defaultDosage: '1 tsp', defaultFrequency: 'at bedtime', defaultDuration: '14 days' },
    { name: 'Brahmi', genericName: 'Bacopa monnieri', strength: '250 mg', dosageForm: 'capsule', sellingPrice: 320, purchasePrice: 180, minimumStockLevel: 15, category: 'Medhya', unit: 'bottle' },
    { name: 'Neem tablets', genericName: 'Azadirachta indica', strength: '400 mg', dosageForm: 'tablet', sellingPrice: 140, purchasePrice: 70, minimumStockLevel: 25, category: 'Skin', unit: 'strip' },
    { name: 'Chyawanprash', genericName: 'Chyawanprash', strength: '500 g', dosageForm: 'other', sellingPrice: 450, purchasePrice: 260, minimumStockLevel: 10, category: 'Immunity', unit: 'jar' },
    { name: 'Tila taila', genericName: 'Sesame oil', strength: '200 ml', dosageForm: 'oil', sellingPrice: 220, purchasePrice: 110, minimumStockLevel: 8, category: 'Panchakarma', unit: 'bottle' },
    { name: 'Dashamoola kwath', genericName: 'Dashamoola', strength: '200 ml', dosageForm: 'syrup', sellingPrice: 190, purchasePrice: 95, minimumStockLevel: 12, category: 'Pain', unit: 'bottle' },
    { name: 'Haridra', genericName: 'Curcuma longa', strength: '400 mg', dosageForm: 'capsule', sellingPrice: 210, purchasePrice: 100, minimumStockLevel: 20, category: 'Anti-inflammatory', unit: 'bottle' },
    { name: 'Shatavari', genericName: 'Asparagus racemosus', strength: '500 mg', dosageForm: 'capsule', sellingPrice: 300, purchasePrice: 170, minimumStockLevel: 10, category: 'Women', unit: 'bottle' },
    { name: 'Yakrit plus', genericName: 'Liver support', strength: '300 mg', dosageForm: 'tablet', sellingPrice: 240, purchasePrice: 130, minimumStockLevel: 18, category: 'Liver', unit: 'strip' },
    { name: 'Kumkumadi cream', genericName: 'Kumkumadi', strength: '50 g', dosageForm: 'cream', sellingPrice: 560, purchasePrice: 310, minimumStockLevel: 6, category: 'Skin', unit: 'tube' },
    { name: 'Anu taila', genericName: 'Anu taila', strength: '10 ml', dosageForm: 'drops', sellingPrice: 160, purchasePrice: 80, minimumStockLevel: 10, category: 'Nasya', unit: 'bottle' },
  ];

  counts.medicines = 0;
  const medicines = [];
  for (const spec of medicineSpecs) {
    const { doc, created } = await ensure(
      Medicine,
      { clinicId: clinic._id, name: spec.name },
      {
        clinicId: clinic._id,
        isActive: true,
        taxRate: 5,
        hsnCode: '3004',
        defaultFrequency: spec.defaultFrequency || 'twice daily after food',
        defaultDuration: spec.defaultDuration || '7 days',
        instructions: 'Take after food with warm water unless specified.',
        manufacturer: spec.manufacturer || 'Kerala Ayurvedics',
        ...spec,
      }
    );
    if (created) counts.medicines += 1;
    medicines.push(doc);
  }

  const ashwagandha = medicines.find((m) => m.name === 'Ashwagandha');
  const triphala = medicines.find((m) => m.name === 'Triphala churna');
  const neem = medicines.find((m) => m.name === 'Neem tablets');
  const tila = medicines.find((m) => m.name === 'Tila taila');
  const kumkumadi = medicines.find((m) => m.name === 'Kumkumadi cream');

  const lotSpecs = [
    { medicine: ashwagandha, branch: mainBranch, batch: 'DEMO-ASH-2401', qty: 48, expiry: day(240), supplier: 'Kerala Ayurvedics' },
    { medicine: triphala, branch: mainBranch, batch: 'DEMO-TRI-2402', qty: 30, expiry: day(180), supplier: 'Kerala Ayurvedics' },
    { medicine: neem, branch: mainBranch, batch: 'DEMO-NEE-LOW', qty: 4, expiry: day(90), supplier: 'Local wholesaler' },
    { medicine: tila, branch: mainBranch, batch: 'DEMO-TIL-EXP', qty: 9, expiry: day(18), supplier: 'Panchakarma oils Co' },
    { medicine: kumkumadi, branch: westBranch, batch: 'DEMO-KUM-WEST', qty: 14, expiry: day(120), supplier: 'Skin lab' },
    { medicine: medicines.find((m) => m.name === 'Brahmi'), branch: mainBranch, batch: 'DEMO-BRA-2403', qty: 22, expiry: day(200), supplier: 'Kerala Ayurvedics' },
    { medicine: medicines.find((m) => m.name === 'Chyawanprash'), branch: mainBranch, batch: 'DEMO-CHY-2404', qty: 16, expiry: day(150), supplier: 'Dabur-style' },
    { medicine: medicines.find((m) => m.name === 'Dashamoola kwath'), branch: westBranch, batch: 'DEMO-DAS-WEST', qty: 11, expiry: day(70), supplier: 'Kwath house' },
  ];

  counts.lots = 0;
  counts.stockMoves = 0;
  const lots = [];
  for (const spec of lotSpecs) {
    if (!spec.medicine) continue;
    const { doc, created } = await ensure(
      InventoryLot,
      { clinicId: clinic._id, batchNumber: spec.batch, medicineId: spec.medicine._id },
      {
        clinicId: clinic._id,
        branchId: spec.branch._id,
        medicineId: spec.medicine._id,
        batchNumber: spec.batch,
        quantity: spec.qty,
        purchasePrice: spec.medicine.purchasePrice,
        sellingPrice: spec.medicine.sellingPrice,
        expiryDate: spec.expiry,
        supplier: spec.supplier,
        receivedAt: day(-14),
        isActive: true,
      }
    );
    if (created) counts.lots += 1;
    lots.push(doc);
    const txn = await InventoryTransaction.findOne({ lotId: doc._id, type: 'stock_in', referenceType: 'demo_seed' });
    if (!txn) {
      await InventoryTransaction.create({
        clinicId: clinic._id,
        branchId: spec.branch._id,
        medicineId: spec.medicine._id,
        lotId: doc._id,
        type: 'stock_in',
        quantity: spec.qty,
        balanceAfter: spec.qty,
        unitCost: spec.medicine.purchasePrice,
        referenceType: 'demo_seed',
        referenceId: doc._id,
        reason: 'Demo opening stock',
        performedBy: admin._id,
      });
      counts.stockMoves += 1;
    }
  }

  const patientSpecs = [
    { name: 'Aarav Shah', phone: '9876500101', gender: 'male', age: 34, tags: [TAG, 'new'], city: 'Mumbai', allergies: ['Penicillin'], conditions: [], reason: 'Seasonal allergy and sinus' },
    { name: 'Diya Kapoor', phone: '9876500102', gender: 'female', age: 29, tags: [TAG, 'panchakarma'], city: 'Mumbai', allergies: [], conditions: ['PCOS'], reason: 'Panchakarma consult' },
    { name: 'Rohan Joshi', phone: '9876500103', gender: 'male', age: 52, tags: [TAG, 'diabetes'], city: 'Thane', allergies: [], conditions: ['Type 2 diabetes'], reason: 'Blood sugar and energy' },
    { name: 'Meera Nair', phone: '9876500104', gender: 'female', age: 41, tags: [TAG, 'vip'], city: 'Mumbai', allergies: ['Dust'], conditions: ['Migraine'], reason: 'Chronic migraine' },
    { name: 'Kabir Khan', phone: '9876500105', gender: 'male', age: 38, tags: [TAG, 'followup'], city: 'Navi Mumbai', allergies: [], conditions: ['Acid reflux'], reason: 'Digestive follow-up' },
    { name: 'Sana Qureshi', phone: '9876500106', gender: 'female', age: 46, tags: [TAG, 'skin'], city: 'Mumbai', allergies: ['Nickel'], conditions: ['Eczema'], reason: 'Skin flare' },
    { name: 'Ishaan Patel', phone: '9876500107', gender: 'male', age: 8, tags: [TAG, 'pediatric'], city: 'Mumbai', allergies: [], conditions: [], reason: 'Immunity and appetite' },
    { name: 'Ananya Iyer', phone: '9876500108', gender: 'female', age: 63, tags: [TAG, 'joint'], city: 'Pune', allergies: [], conditions: ['Osteoarthritis'], reason: 'Knee pain' },
    { name: 'Vikram Rao', phone: '9876500109', gender: 'male', age: 45, tags: [TAG, 'stress'], city: 'Mumbai', allergies: [], conditions: ['Insomnia'], reason: 'Stress and sleep' },
    { name: 'Priya Menon', phone: '9876500110', gender: 'female', age: 31, tags: [TAG, 'prenatal'], city: 'Mumbai', allergies: [], conditions: [], reason: 'Prenatal Ayurveda' },
    { name: 'Farhan Ali', phone: '9876500111', gender: 'male', age: 27, tags: [TAG, 'sports'], city: 'Mumbai', allergies: [], conditions: [], reason: 'Sports recovery' },
    { name: 'Leela Krishnan', phone: '9876500112', gender: 'female', age: 57, tags: [TAG, 'inactive'], city: 'Mumbai', allergies: [], conditions: ['Hypertension'], reason: 'Blood pressure review' },
  ];

  counts.patients = 0;
  const patients = [];
  for (let i = 0; i < patientSpecs.length; i += 1) {
    const spec = patientSpecs[i];
    const assignedDoctor = i % 5 === 0 ? doctor2 : doctor;
    const branch = i % 4 === 0 ? westBranch : mainBranch;
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - spec.age);
    dob.setMonth(3);
    dob.setDate(12);
    const { firstName, lastName } = splitName(spec.name);
    const existing = await Patient.findOne({ clinicId: clinic._id, phone: spec.phone });
    if (existing) {
      patients.push(existing);
      continue;
    }
    const doc = await Patient.create({
      clinicId: clinic._id,
      doctorId: assignedDoctor._id,
      branchId: branch._id,
      tags: spec.tags,
      patientCode: await generatePatientCode(),
      firstName,
      lastName,
      name: spec.name,
      phone: spec.phone,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@demo.patient.local`,
      dateOfBirth: dob,
      age: deriveAge(dob) || spec.age,
      gender: spec.gender,
      address: `${10 + i}, Demo Residency`,
      city: spec.city,
      state: 'Maharashtra',
      postalCode: '4000' + String(10 + i),
      emergencyContact: { name: 'Family member', relationship: 'Spouse', phone: '9876500199' },
      clinical: {
        allergies: spec.allergies,
        conditions: spec.conditions,
        medications: spec.conditions.includes('Type 2 diabetes') ? ['Metformin 500 mg'] : [],
        medicalHistory: spec.conditions.join(', '),
        familyHistory: i % 3 === 0 ? 'Father: diabetes' : '',
        surgeries: '',
        alerts: spec.allergies.length ? spec.allergies.map((a) => `Allergy: ${a}`) : [],
      },
      medicalHistory: spec.conditions.join(', '),
      notes: `[DEMO] ${spec.reason}`,
      isActive: true,
    });
    counts.patients += 1;
    patients.push(doc);
    await PatientEvent.create({
      clinicId: clinic._id,
      doctorId: assignedDoctor._id,
      patientId: doc._id,
      type: 'patient_created',
      title: 'Patient registered',
      detail: 'Demo seed',
    });
  }

  const byPhone = (phone) => patients.find((p) => p.phone === phone);

  const appointmentPlan = [
    { patient: '9876500101', offset: 0, slot: '09:00', status: 'confirmed', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500102', offset: 0, slot: '10:00', status: 'confirmed', type: 'Panchakarma', doctor: doctor2, branch: westBranch },
    { patient: '9876500103', offset: 0, slot: '11:00', status: 'scheduled', type: 'Follow-up', doctor, branch: mainBranch },
    { patient: '9876500104', offset: 0, slot: '14:00', status: 'scheduled', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500105', offset: 0, slot: '15:00', status: 'confirmed', type: 'Follow-up', doctor, branch: mainBranch },
    { patient: '9876500106', offset: 1, slot: '09:00', status: 'scheduled', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500107', offset: 1, slot: '10:00', status: 'scheduled', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500108', offset: 2, slot: '11:00', status: 'scheduled', type: 'Procedure', doctor: doctor2, branch: westBranch },
    { patient: '9876500101', offset: -3, slot: '10:00', status: 'completed', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500103', offset: -7, slot: '11:00', status: 'completed', type: 'Follow-up', doctor, branch: mainBranch },
    { patient: '9876500104', offset: -10, slot: '14:00', status: 'completed', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500105', offset: -14, slot: '09:00', status: 'completed', type: 'Follow-up', doctor, branch: mainBranch },
    { patient: '9876500109', offset: -2, slot: '16:00', status: 'no_show', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500110', offset: 3, slot: '15:00', status: 'cancelled', type: 'Consultation', doctor, branch: mainBranch },
    { patient: '9876500111', offset: -1, slot: '17:00', status: 'completed', type: 'Consultation', doctor: doctor2, branch: westBranch },
    { patient: '9876500112', offset: -40, slot: '10:00', status: 'completed', type: 'Follow-up', doctor, branch: mainBranch },
  ];

  counts.appointments = 0;
  const appointments = [];
  for (const plan of appointmentPlan) {
    const patient = byPhone(plan.patient);
    if (!patient) continue;
    const appointmentDate = day(plan.offset);
    let doc;
    let created = false;
    try {
      const ensured = await ensure(
        Appointment,
        {
          doctor: plan.doctor._id,
          appointmentDate,
          timeSlot: plan.slot,
          notes: '[DEMO]',
        },
        {
          clinicId: clinic._id,
          branchId: plan.branch._id,
          patientId: patient._id,
          doctor: plan.doctor._id,
          appointmentDate,
          timeSlot: plan.slot,
          durationMinutes: 30,
          appointmentType: plan.type,
          reason: patient.notes?.replace('[DEMO] ', '') || 'Consultation',
          status: plan.status,
          notes: '[DEMO]',
          reminderScheduled: plan.offset >= 0 && plan.status !== 'cancelled',
        }
      );
      doc = ensured.doc;
      created = ensured.created;
    } catch (err) {
      console.warn(`Skipped appointment ${plan.slot} ${appointmentDate.toISOString().slice(0, 10)}: ${err.message}`);
      continue;
    }
    if (created) {
      counts.appointments += 1;
      await PatientEvent.create({
        clinicId: clinic._id,
        doctorId: plan.doctor._id,
        patientId: patient._id,
        appointmentId: doc._id,
        type:
          plan.status === 'completed'
            ? 'appointment_completed'
            : plan.status === 'cancelled'
              ? 'appointment_cancelled'
              : plan.status === 'no_show'
                ? 'appointment_no_show'
                : 'appointment_scheduled',
        title: `Appointment ${plan.status}`,
        detail: `${plan.slot} · ${plan.type}`,
      });
    }
    appointments.push(doc);
  }

  const completedAppts = appointments.filter((a) => a.status === 'completed');
  counts.consultations = 0;
  counts.prescriptions = 0;
  for (const appt of completedAppts) {
    const patient = patients.find((p) => String(p._id) === String(appt.patientId));
    const { doc: consult, created } = await ensure(
      Consultation,
      { appointmentId: appt._id },
      {
        clinicId: clinic._id,
        branchId: appt.branchId,
        doctorId: appt.doctor,
        patientId: appt.patientId,
        appointmentId: appt._id,
        chiefComplaint: patient?.notes?.replace('[DEMO] ', '') || 'General discomfort',
        symptoms: 'Reported for 2–3 weeks. Sleep disrupted.',
        observation: 'Nadi slightly vata. Abdomen soft. No acute distress.',
        diagnosis: 'Vata-pitta imbalance',
        treatment: 'Deepana-pachana, lifestyle correction, prescribed rasayana.',
        advice: 'Warm meals, early dinner, 20 min walk.',
        followUp: 'Review in 14 days',
        vitals: { bp: '122/78', pulse: '72', temperature: '98.4 F', weight: '68', height: '168', spo2: '98' },
        status: 'completed',
        completedAt: appt.appointmentDate,
      }
    );
    if (created) counts.consultations += 1;

    const existingRx = await Prescription.findOne({ appointmentId: appt._id });
    if (!existingRx) {
      await Prescription.create({
        clinicId: clinic._id,
        branchId: appt.branchId,
        doctorId: appt.doctor,
        patientId: appt.patientId,
        appointmentId: appt._id,
        consultationId: consult._id,
        items: [
          {
            medicineId: ashwagandha._id,
            name: ashwagandha.name,
            genericName: ashwagandha.genericName,
            dosage: '1 capsule',
            frequency: 'twice daily',
            duration: '30 days',
            instructions: 'After food with warm water',
            quantity: 1,
          },
          {
            medicineId: triphala._id,
            name: triphala.name,
            genericName: triphala.genericName,
            dosage: '1 tsp',
            frequency: 'at bedtime',
            duration: '14 days',
            instructions: 'With warm water',
            quantity: 1,
          },
        ],
        notes: 'Avoid curd at night.',
        followUpInstructions: 'Return in 2 weeks or earlier if symptoms worsen.',
      });
      counts.prescriptions += 1;
      await PatientEvent.create({
        clinicId: clinic._id,
        doctorId: appt.doctor,
        patientId: appt.patientId,
        appointmentId: appt._id,
        type: 'consultation_completed',
        title: 'Consultation completed',
        detail: consult.diagnosis,
      });
    }
  }

  const invoicePlans = [
    { patient: '9876500101', apptOffset: -3, status: 'paid', method: 'upi', items: 'consult+med' },
    { patient: '9876500103', apptOffset: -7, status: 'partially_paid', method: 'cash', items: 'consult' },
    { patient: '9876500104', apptOffset: -10, status: 'unpaid', method: null, items: 'consult+proc' },
    { patient: '9876500105', apptOffset: -14, status: 'refunded', method: 'card', items: 'consult' },
    { patient: '9876500111', apptOffset: -1, status: 'paid', method: 'cash', items: 'consult+med' },
    { patient: '9876500102', apptOffset: 0, status: 'unpaid', method: null, items: 'consult' },
  ];

  counts.invoices = 0;
  counts.payments = 0;
  for (const plan of invoicePlans) {
    const patient = byPhone(plan.patient);
    const appt = appointments.find(
      (a) => String(a.patientId) === String(patient._id) && a.appointmentDate.getTime() === day(plan.apptOffset).getTime()
    );
    if (!patient) continue;
    const existing = await Invoice.findOne({ clinicId: clinic._id, patientId: patient._id, notes: `[DEMO] ${plan.status}` });
    if (existing) continue;

    const consultFee = 700;
    const rawItems = [{ type: 'consultation', name: 'Ayurvedic consultation', quantity: 1, unitPrice: consultFee, discount: 0 }];
    if (plan.items.includes('med')) {
      rawItems.push({
        type: 'medicine',
        name: ashwagandha.name,
        quantity: 1,
        unitPrice: ashwagandha.sellingPrice,
        discount: 0,
        medicineId: ashwagandha._id,
        lotId: lots.find((l) => String(l.medicineId) === String(ashwagandha._id))?._id || null,
      });
    }
    if (plan.items.includes('proc')) {
      rawItems.push({ type: 'procedure', name: 'Abhyanga (45 min)', quantity: 1, unitPrice: 1200, discount: 0 });
    }
    const totals = computeInvoiceTotals({ items: rawItems, discount: plan.status === 'partially_paid' ? 50 : 0, taxRate: 5 });
    let paidAmount = 0;
    if (plan.status === 'paid' || plan.status === 'refunded') paidAmount = totals.total;
    if (plan.status === 'partially_paid') paidAmount = roundMoney(totals.total * 0.4);
    const refundedAmount = plan.status === 'refunded' ? totals.total : 0;
    const derived = paymentStatusFromAmounts(totals.total, paidAmount, refundedAmount);

    const invoice = await Invoice.create({
      invoiceNumber: await nextInvoiceNumber(clinic._id),
      clinicId: clinic._id,
      branchId: appt?.branchId || patient.branchId || mainBranch._id,
      patientId: patient._id,
      doctorId: appt?.doctor || patient.doctorId,
      appointmentId: appt?._id || null,
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
      invoiceDate: appt?.appointmentDate || day(-2),
      notes: `[DEMO] ${plan.status}`,
      createdBy: admin._id,
      inventoryDeducted: plan.status === 'paid' && plan.items.includes('med'),
    });
    counts.invoices += 1;

    if (paidAmount > 0) {
      const pay = await Payment.create({
        invoiceId: invoice._id,
        clinicId: clinic._id,
        branchId: invoice.branchId,
        amount: paidAmount,
        paymentMethod: plan.method || 'cash',
        transactionReference: plan.method === 'upi' ? 'UPI-DEMO-88421' : '',
        paymentDate: invoice.invoiceDate,
        receivedBy: admin._id,
        status: 'completed',
        receiptNumber: await nextReceiptNumber(clinic._id),
        notes: '[DEMO] payment',
      });
      counts.payments += 1;
      if (plan.status === 'refunded') {
        await Payment.create({
          invoiceId: invoice._id,
          clinicId: clinic._id,
          branchId: invoice.branchId,
          amount: refundedAmount,
          paymentMethod: plan.method || 'card',
          paymentDate: day(-8),
          receivedBy: admin._id,
          status: 'refunded',
          receiptNumber: await nextReceiptNumber(clinic._id),
          notes: '[DEMO] refund',
          refundOf: pay._id,
        });
        counts.payments += 1;
      }
      await PatientEvent.create({
        clinicId: clinic._id,
        doctorId: invoice.doctorId,
        patientId: patient._id,
        type: 'payment_received',
        title: plan.status === 'refunded' ? 'Payment refunded' : 'Payment received',
        detail: `${invoice.invoiceNumber} · ₹${paidAmount}`,
      });
    } else {
      await PatientEvent.create({
        clinicId: clinic._id,
        doctorId: invoice.doctorId,
        patientId: patient._id,
        type: 'invoice_created',
        title: 'Invoice created',
        detail: `${invoice.invoiceNumber} · unpaid`,
      });
    }
  }

  const todayAppts = appointments.filter((a) => a.appointmentDate.getTime() === day(0).getTime() && ['scheduled', 'confirmed'].includes(a.status));
  const queueStates = ['waiting', 'called', 'in_consultation', 'waiting', 'waiting'];
  counts.queue = 0;
  let token = 1;
  for (let i = 0; i < todayAppts.length; i += 1) {
    const appt = todayAppts[i];
    const branchId = appt.branchId || mainBranch._id;
    const existing = await QueueTicket.findOne({
      clinicId: clinic._id,
      appointmentId: appt._id,
      queueDate: day(0),
    });
    if (existing) continue;
    const status = queueStates[i] || 'waiting';
    const now = new Date();
    await QueueTicket.create({
      clinicId: clinic._id,
      branchId,
      doctorId: appt.doctor,
      patientId: appt.patientId,
      appointmentId: appt._id,
      tokenNumber: token,
      tokenLabel: `${branchId.equals(westBranch._id) ? 'B' : 'A'}${token}`,
      roomLabel: branchId.equals(westBranch._id) ? westBranch.roomLabel : mainBranch.roomLabel,
      status,
      queueDate: day(0),
      checkedInAt: at(0, 8, 40 + i * 8),
      calledAt: ['called', 'in_consultation'].includes(status) ? now : null,
      startedAt: status === 'in_consultation' ? now : null,
      createdBy: admin._id,
    });
    token += 1;
    counts.queue += 1;
  }

  const consentBodies = [
    {
      name: 'General treatment consent',
      category: 'treatment',
      body: 'I consent to Ayurvedic consultation and treatment at this clinic. I have been informed of the nature of care, possible benefits, and that outcomes vary. I may withdraw consent at any time.',
    },
    {
      name: 'Panchakarma procedure consent',
      category: 'procedure',
      body: 'I consent to Panchakarma procedures including snehana, swedana, and related therapies as advised. I confirm I have disclosed pregnancy, bleeding disorders, and current medicines. I understand rest and diet are part of care.',
    },
    {
      name: 'Privacy & records consent',
      category: 'privacy',
      body: 'I consent to the clinic storing my health records for treatment, billing, and legally required retention. Data is not shared outside the clinic except as required by law or with my written permission.',
    },
  ];
  counts.consentTemplates = 0;
  const consentTpls = [];
  for (const spec of consentBodies) {
    const { doc, created } = await ensure(
      ConsentTemplate,
      { clinicId: clinic._id, name: spec.name },
      { clinicId: clinic._id, ...spec, version: 1, isActive: true }
    );
    if (created) counts.consentTemplates += 1;
    consentTpls.push(doc);
  }

  counts.consentRecords = 0;
  const consentRecordPlans = [
    { patient: '9876500101', tpl: 0, status: 'accepted' },
    { patient: '9876500102', tpl: 1, status: 'accepted' },
    { patient: '9876500104', tpl: 0, status: 'pending' },
    { patient: '9876500106', tpl: 2, status: 'rejected' },
  ];
  for (const plan of consentRecordPlans) {
    const patient = byPhone(plan.patient);
    const tpl = consentTpls[plan.tpl];
    const { created } = await ensure(
      ConsentRecord,
      { clinicId: clinic._id, patientId: patient._id, consentTemplateId: tpl._id },
      {
        clinicId: clinic._id,
        branchId: patient.branchId,
        consentTemplateId: tpl._id,
        patientId: patient._id,
        doctorId: patient.doctorId,
        version: tpl.version,
        titleSnapshot: tpl.name,
        bodySnapshot: tpl.body,
        status: plan.status,
        signedAt: plan.status === 'accepted' ? day(-1) : null,
        signatureDataUrl: plan.status === 'accepted' ? SIGNATURE : '',
        signerName: plan.status === 'accepted' ? patient.name : '',
        capturedBy: admin._id,
      }
    );
    if (created) counts.consentRecords += 1;
  }

  counts.campaigns = 0;
  const { doc: campDone, created: campDoneNew } = await ensure(
    Campaign,
    { clinicId: clinic._id, name: 'DEMO: Follow-up wellness' },
    {
      clinicId: clinic._id,
      branchId: mainBranch._id,
      name: 'DEMO: Follow-up wellness',
      message: 'Namaste {{name}}, this is a gentle reminder from Shreeshakti Ayurveda to continue your medicines and book a review if symptoms persist. Reply if you need a slot.',
      channel: 'whatsapp',
      audienceType: 'followup',
      status: 'completed',
      recipientCount: 3,
      sentCount: 3,
      failedCount: 0,
      confirmedAt: day(-1),
      createdBy: admin._id,
    }
  );
  if (campDoneNew) counts.campaigns += 1;

  const { created: campDraftNew } = await ensure(
    Campaign,
    { clinicId: clinic._id, name: 'DEMO: Seasonal immunity (draft)' },
    {
      clinicId: clinic._id,
      name: 'DEMO: Seasonal immunity (draft)',
      message: 'Monsoon immunity camp this weekend. Book a slot for a rasayana consult.',
      channel: 'whatsapp',
      audienceType: 'all',
      status: 'draft',
      recipientCount: 0,
      createdBy: admin._id,
    }
  );
  if (campDraftNew) counts.campaigns += 1;

  const { created: campSchedNew } = await ensure(
    Campaign,
    { clinicId: clinic._id, name: 'DEMO: Panchakarma camp (scheduled)' },
    {
      clinicId: clinic._id,
      branchId: westBranch._id,
      name: 'DEMO: Panchakarma camp (scheduled)',
      message: 'Panchakarma screening at Andheri West next Saturday. Limited tokens.',
      channel: 'sms',
      audienceType: 'tags',
      audienceFilter: { tags: ['panchakarma'] },
      scheduledAt: day(5),
      status: 'scheduled',
      recipientCount: 1,
      createdBy: admin._id,
    }
  );
  if (campSchedNew) counts.campaigns += 1;

  counts.deliveries = 0;
  for (const phone of ['9876500103', '9876500105', '9876500112']) {
    const patient = byPhone(phone);
    const { created } = await ensure(
      CampaignDelivery,
      { campaignId: campDone._id, patientId: patient._id },
      {
        clinicId: clinic._id,
        campaignId: campDone._id,
        patientId: patient._id,
        channel: 'whatsapp',
        recipientPhone: patient.phone,
        recipientEmail: patient.email,
        recipientName: patient.name,
        status: 'sent',
        sentAt: day(-1),
        provider: 'internal',
      }
    );
    if (created) counts.deliveries += 1;
  }

  counts.notes = 0;
  for (const phone of ['9876500103', '9876500104', '9876500108']) {
    const patient = byPhone(phone);
    const existing = await PatientNote.findOne({ patientId: patient._id, body: /\[DEMO\]/ });
    if (existing) continue;
    await PatientNote.create({
      clinicId: clinic._id,
      doctorId: patient.doctorId,
      patientId: patient._id,
      body: '[DEMO] Patient prefers morning slots. Responded well to last rasayana course.',
    });
    counts.notes += 1;
  }

  const upcoming = appointments.find((a) => a.status === 'confirmed' && a.appointmentDate.getTime() === day(0).getTime());
  if (upcoming) {
    await ensure(
      NotificationLog,
      { appointmentId: upcoming._id, notificationType: 'appointment_reminder' },
      {
        clinicId: clinic._id,
        appointmentId: upcoming._id,
        patientId: upcoming.patientId,
        recipientPhone: byPhone('9876500101')?.phone,
        recipientName: byPhone('9876500101')?.name,
        notificationType: 'appointment_reminder',
        channel: 'whatsapp_link',
        message: 'Reminder: consultation today.',
        scheduledAt: at(0, 7, 0),
        sentAt: at(0, 7, 5),
        status: 'sent',
        provider: 'internal',
      }
    );
  }

  counts.inbox = 0;
  const inboxItems = [
    { type: 'appointment_scheduled', title: 'New visit booked', body: 'Diya Kapoor booked Panchakarma for today 10:00.' },
    { type: 'upcoming_appointment', title: 'Next patient', body: 'Aarav Shah is confirmed at 09:00 in Consult 1.' },
    { type: 'reminder_sent', title: 'Reminder delivered', body: 'WhatsApp reminder logged for today’s first visit.' },
    { type: 'patient_added', title: 'New patient', body: 'Leela Krishnan was added from demo seed.' },
  ];
  for (const item of inboxItems) {
    const { created } = await ensure(
      DoctorNotification,
      { doctorId: doctor._id, title: item.title },
      {
        doctorId: doctor._id,
        clinicId: clinic._id,
        type: item.type,
        title: item.title,
        body: item.body,
        link: '/doctor/calendar',
        readAt: null,
      }
    );
    if (created) counts.inbox += 1;
  }

  counts.audit = 0;
  const auditItems = [
    { action: 'staff_created', entityType: 'User', detail: 'Demo receptionist Anita Desai' },
    { action: 'branch_created', entityType: 'Branch', detail: 'Andheri West branch' },
    { action: 'invoice_created', entityType: 'Invoice', detail: 'Demo invoices seeded' },
    { action: 'campaign_sent', entityType: 'Campaign', detail: 'Follow-up wellness campaign' },
    { action: 'queue_checkin', entityType: 'QueueTicket', detail: 'Morning queue opened' },
  ];
  for (const item of auditItems) {
    const { created } = await ensure(
      AuditLog,
      { clinicId: clinic._id, action: item.action, detail: item.detail },
      {
        clinicId: clinic._id,
        branchId: mainBranch._id,
        actorId: admin._id,
        ...item,
      }
    );
    if (created) counts.audit += 1;
  }

  console.log('\nDemo data ready for', clinic.name);
  console.log('Created this run:', JSON.stringify(counts, null, 2));
  console.log('\nSign in as clinic admin (existing account) or these demo users — password Demo@123');
  console.log('  Manager       meera.manager@demo.shreeshakti.local');
  console.log('  Reception     anita.desk@demo.shreeshakti.local');
  console.log('  Nurse         kavita.nurse@demo.shreeshakti.local');
  console.log('  Assistant     ravi.assist@demo.shreeshakti.local');
  console.log('  Doctor        dr.arjun@demo.shreeshakti.local');
  console.log('  Pending doctor dr.pending@demo.shreeshakti.local  (shows on admin Approvals)');
  console.log('\nCheck: Dashboard, Front desk, Patients, Calendar, Queue, Billing, Revenue,');
  console.log('Medicines, Inventory (low stock + expiring), Templates, Consent, Campaigns,');
  console.log('Staff, Branches, Search, Print settings, Patient billing tab, Start consultation.\n');

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
