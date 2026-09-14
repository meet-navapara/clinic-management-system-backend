import Clinic from '../models/Clinic.js';
import User from '../models/User.js';
import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Consultation from '../models/Consultation.js';
import Prescription from '../models/Prescription.js';
import ConsentRecord from '../models/ConsentRecord.js';
import { DEFAULT_CLINIC_SLUG, DEFAULT_CLINIC_NAME } from './migrateClinic.js';
import { provisionClinicForDoctor } from './clinicProvisioning.js';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Doctors who self-registered were incorrectly attached to the shared demo clinic.
 * Move each such doctor (and ONLY their own operational records) into a new clinic.
 * Never deletes data. Skips demo/shared clinic doctors whose clinicName matches the default.
 */
export const migrateDoctorClinicIsolation = async () => {
  const shared = await Clinic.findOne({ slug: DEFAULT_CLINIC_SLUG });
  if (!shared) return;

  const doctors = await User.find({
    role: 'doctor',
    clinicId: shared._id,
  }).select('_id name email clinicName clinicAddress city phone');

  let moved = 0;

  for (const doctor of doctors) {
    const ownName = norm(doctor.clinicName);
    const sharedName = norm(shared.name || DEFAULT_CLINIC_NAME);
    // Keep true Shreeshakti / demo doctors on the shared clinic.
    if (ownName === sharedName || ownName.includes('shreeshakti')) {
      continue;
    }
    const email = String(doctor.email || '').toLowerCase();
    // Demo seed / platform emails stay on shared clinic even if clinicName is blank.
    if (email.includes('demo.shreeshakti') || email.endsWith('@shreeshakti.com')) {
      continue;
    }

    const practiceLabel =
      String(doctor.clinicName || '').trim() ||
      `${String(doctor.name || 'Doctor').trim()}'s Clinic`;

    const { clinic, branch } = await provisionClinicForDoctor({
      clinicName: practiceLabel,
      clinicAddress: doctor.clinicAddress || '',
      city: doctor.city || '',
      phone: doctor.phone || '',
      email: doctor.email || '',
    });

    await User.updateOne(
      { _id: doctor._id },
      {
        $set: {
          clinicId: clinic._id,
          branchIds: [branch._id],
          defaultBranchId: branch._id,
          clinicName: clinic.name,
        },
      }
    );

    // Move only this doctor's operational rows off the shared clinic.
    const patientIds = await Patient.find({ doctorId: doctor._id, clinicId: shared._id }).distinct('_id');
    if (patientIds.length) {
      await Patient.updateMany(
        { _id: { $in: patientIds } },
        { $set: { clinicId: clinic._id, branchId: branch._id } }
      );
      await Appointment.updateMany(
        { patientId: { $in: patientIds }, clinicId: shared._id },
        { $set: { clinicId: clinic._id, branchId: branch._id } }
      );
      const invoiceIds = await Invoice.find({ patientId: { $in: patientIds }, clinicId: shared._id }).distinct('_id');
      if (invoiceIds.length) {
        await Invoice.updateMany(
          { _id: { $in: invoiceIds } },
          { $set: { clinicId: clinic._id, branchId: branch._id } }
        );
        await Payment.updateMany(
          { invoiceId: { $in: invoiceIds } },
          { $set: { clinicId: clinic._id, branchId: branch._id } }
        );
      }
      await Consultation.updateMany(
        { patientId: { $in: patientIds }, clinicId: shared._id },
        { $set: { clinicId: clinic._id, branchId: branch._id } }
      );
      await Prescription.updateMany(
        { patientId: { $in: patientIds }, clinicId: shared._id },
        { $set: { clinicId: clinic._id, branchId: branch._id } }
      );
      await ConsentRecord.updateMany(
        { patientId: { $in: patientIds }, clinicId: shared._id },
        { $set: { clinicId: clinic._id, branchId: branch._id } }
      );
    }

    await Appointment.updateMany(
      { doctor: doctor._id, clinicId: shared._id },
      { $set: { clinicId: clinic._id, branchId: branch._id } }
    );

    moved += 1;
    console.log(`Isolated doctor ${doctor.email} → clinic ${clinic.name} (${clinic._id})`);
  }

  if (moved) {
    console.log(`Doctor clinic isolation: moved ${moved} doctor(s) off shared clinic.`);
  }
};
