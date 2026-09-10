import Patient from '../models/Patient.js';
import { generatePatientCode, splitName } from './patientHelpers.js';
import Appointment from '../models/Appointment.js';

/**
 * Backfill patientCode / name parts and normalize legacy appointment statuses.
 */
export async function migratePracticeDomain() {
  const missingCode = await Patient.find({
    $or: [{ patientCode: { $exists: false } }, { patientCode: null }, { patientCode: '' }],
  }).limit(500);

  for (const patient of missingCode) {
    if (!patient.firstName && patient.name) {
      const { firstName, lastName } = splitName(patient.name);
      patient.firstName = firstName;
      patient.lastName = lastName;
    }
    patient.patientCode = await generatePatientCode();
    await patient.save();
  }

  const pending = await Appointment.updateMany(
    { status: 'pending' },
    { $set: { status: 'scheduled' } }
  );

  if (missingCode.length || pending.modifiedCount) {
    console.log(
      `Practice migrate: ${missingCode.length} patient codes, ${pending.modifiedCount} appointment statuses`
    );
  }
}
