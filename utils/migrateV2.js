import Clinic from '../models/Clinic.js';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import PrintSettings from '../models/PrintSettings.js';
import ClinicalTemplate from '../models/ClinicalTemplate.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Consultation from '../models/Consultation.js';
import Prescription from '../models/Prescription.js';

const DEFAULT_CLINICAL_TEMPLATES = [
  {
    name: 'General consultation',
    type: 'consultation',
    fields: {
      chiefComplaint: 'Patient reports ',
      symptoms: '',
      observation: '',
      diagnosis: '',
      treatment: '',
      advice: 'Rest, hydration, take medicines as prescribed. Return if symptoms worsen.',
      followUp: 'Follow up in 7 days or earlier if needed.',
      instructions: '',
    },
  },
  {
    name: 'Follow-up visit',
    type: 'followup_instructions',
    fields: {
      chiefComplaint: 'Follow-up after previous visit.',
      symptoms: 'Review of previous complaints.',
      observation: '',
      diagnosis: '',
      treatment: 'Continue / adjust current plan.',
      advice: 'Continue prescribed medicines. Note any side effects.',
      followUp: 'Review in 14 days.',
      instructions: '',
    },
  },
  {
    name: 'Procedure / treatment',
    type: 'treatment',
    fields: {
      chiefComplaint: '',
      symptoms: '',
      observation: 'Procedure indicated.',
      diagnosis: '',
      treatment: 'Procedure performed as discussed. Consent obtained.',
      advice: 'Post-procedure care explained.',
      followUp: 'Review as advised.',
      instructions: '',
    },
  },
  {
    name: 'Diagnosis notes',
    type: 'diagnosis',
    fields: {
      chiefComplaint: '',
      symptoms: '',
      observation: '',
      diagnosis: '',
      treatment: '',
      advice: '',
      followUp: '',
      instructions: '',
    },
  },
  {
    name: 'Prescription instructions',
    type: 'prescription_instructions',
    fields: {
      chiefComplaint: '',
      symptoms: '',
      observation: '',
      diagnosis: '',
      treatment: '',
      advice: 'Take medicines after food unless specified. Complete the full course.',
      followUp: '',
      instructions: 'Do not skip doses. Store medicines as labelled.',
    },
  },
];

export async function seedClinicTemplates(clinicId) {
  if (!clinicId) return 0;
  let created = 0;
  for (const t of DEFAULT_CLINICAL_TEMPLATES) {
    const existing = await ClinicalTemplate.findOne({
      clinicId,
      name: t.name,
      ownerType: 'clinic',
    });
    if (existing) continue;
    await ClinicalTemplate.create({
      ...t,
      clinicId,
      ownerType: 'clinic',
      doctorId: null,
      isActive: true,
    });
    created += 1;
  }
  return created;
}

/**
 * Additive V2 tenancy: default branch per clinic, backfill branchId,
 * print settings. Never deletes data.
 */
export const migrateV2Foundation = async () => {
  const clinics = await Clinic.find({});
  let branchesCreated = 0;
  let usersPatched = 0;
  let patientsPatched = 0;
  let apptsPatched = 0;
  let extraPatched = 0;

  for (const clinic of clinics) {
    let defaultBranch = await Branch.findOne({ clinicId: clinic._id, isDefault: true });
    if (!defaultBranch) {
      defaultBranch = await Branch.findOne({ clinicId: clinic._id }).sort({ createdAt: 1 });
    }
    if (!defaultBranch) {
      defaultBranch = await Branch.create({
        clinicId: clinic._id,
        name: clinic.name ? `${clinic.name} — Main` : 'Main branch',
        code: 'MAIN',
        address: clinic.address || '',
        phone: clinic.phone || '',
        email: clinic.email || '',
        isDefault: true,
        isActive: true,
        displayTitle: clinic.name || 'Now serving',
      });
      branchesCreated += 1;
    }

    const print = await PrintSettings.findOne({ clinicId: clinic._id });
    if (!print) {
      await PrintSettings.create({
        clinicId: clinic._id,
        clinicName: clinic.name || '',
        address: clinic.address || '',
        phone: clinic.phone || '',
        email: clinic.email || '',
        logo: clinic.logo || '',
        gstNumber: clinic.gstNumber || '',
        registrationNumber: clinic.registrationNumber || '',
        website: clinic.website || '',
      });
    }

    const userResult = await User.updateMany(
      {
        clinicId: clinic._id,
        $and: [
          { $or: [{ branchIds: { $exists: false } }, { branchIds: { $size: 0 } }] },
          { $or: [{ defaultBranchId: { $exists: false } }, { defaultBranchId: null }] },
        ],
      },
      {
        $set: { branchIds: [defaultBranch._id], defaultBranchId: defaultBranch._id },
      }
    );
    usersPatched += userResult.modifiedCount || 0;

    // Normalize staff to a single primary branch (no Main stacking on existing assignment).
    const multiStaff = await User.find({
      clinicId: clinic._id,
      role: { $nin: ['super_admin', 'doctor', 'patient'] },
      $or: [
        { defaultBranchId: null },
        { 'branchIds.1': { $exists: true } },
      ],
    }).select('_id branchIds defaultBranchId');
    for (const u of multiStaff) {
      const primary = u.defaultBranchId || (u.branchIds && u.branchIds[0]) || defaultBranch._id;
      await User.updateOne(
        { _id: u._id },
        { $set: { defaultBranchId: primary, branchIds: [primary] } }
      );
      usersPatched += 1;
    }

    const missingBranch = { clinicId: clinic._id, $or: [{ branchId: { $exists: false } }, { branchId: null }] };

    const patientResult = await Patient.updateMany(missingBranch, { $set: { branchId: defaultBranch._id } });
    patientsPatched += patientResult.modifiedCount || 0;

    const apptResult = await Appointment.updateMany(missingBranch, { $set: { branchId: defaultBranch._id } });
    apptsPatched += apptResult.modifiedCount || 0;

    const invoiceResult = await Invoice.updateMany(missingBranch, { $set: { branchId: defaultBranch._id } });
    const paymentResult = await Payment.updateMany(missingBranch, { $set: { branchId: defaultBranch._id } });
    const consultResult = await Consultation.updateMany(missingBranch, { $set: { branchId: defaultBranch._id } });
    const rxResult = await Prescription.updateMany(missingBranch, { $set: { branchId: defaultBranch._id } });
    extraPatched +=
      (invoiceResult.modifiedCount || 0) +
      (paymentResult.modifiedCount || 0) +
      (consultResult.modifiedCount || 0) +
      (rxResult.modifiedCount || 0);

    const seeded = await seedClinicTemplates(clinic._id);
    if (seeded) {
      console.log(`Seeded ${seeded} clinical templates for ${clinic.name}`);
    }
  }

  if (branchesCreated || usersPatched || patientsPatched || apptsPatched || extraPatched) {
    console.log(
      `V2 migration: ${branchesCreated} default branch(es), ${usersPatched} user(s), ${patientsPatched} patient(s), ${apptsPatched} appointment(s), ${extraPatched} other operational record(s).`
    );
  }
};
