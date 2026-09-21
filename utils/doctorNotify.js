import DoctorNotification from '../models/DoctorNotification.js';

/**
 * Create an in-app inbox notification for a doctor.
 * Skips when actorId === doctorId so doctors are not notified for their own actions.
 */
export async function notifyDoctor({
  doctorId,
  clinicId = null,
  type,
  title,
  body = '',
  link = '',
  metadata = {},
  actorId = null,
}) {
  if (!doctorId || !type || !title) return null;
  if (actorId && String(actorId) === String(doctorId)) return null;
  try {
    return await DoctorNotification.create({
      doctorId,
      clinicId,
      type,
      title,
      body,
      link,
      metadata,
    });
  } catch (err) {
    console.warn('Doctor notification failed:', err.message);
    return null;
  }
}

export async function getUnreadCount(doctorId) {
  return DoctorNotification.countDocuments({ doctorId, readAt: null });
}
