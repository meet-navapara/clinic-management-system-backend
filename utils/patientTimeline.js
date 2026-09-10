import PatientEvent from '../models/PatientEvent.js';

export async function recordPatientEvent({
  clinicId,
  doctorId,
  patientId,
  type,
  title,
  detail = '',
  appointmentId = null,
  metadata = {},
}) {
  if (!doctorId || !patientId || !type || !title) return null;
  try {
    return await PatientEvent.create({
      clinicId: clinicId || null,
      doctorId,
      patientId,
      type,
      title,
      detail,
      appointmentId,
      metadata,
    });
  } catch (err) {
    console.warn('Patient timeline event failed:', err.message);
    return null;
  }
}
