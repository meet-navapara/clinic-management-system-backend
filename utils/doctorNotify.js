import DoctorNotification from '../models/DoctorNotification.js';

export async function notifyDoctor({
  doctorId,
  clinicId = null,
  type,
  title,
  body = '',
  link = '',
  metadata = {},
}) {
  if (!doctorId || !type || !title) return null;
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
