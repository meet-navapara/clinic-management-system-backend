import NotificationLog from '../models/NotificationLog.js';
import DoctorNotification from '../models/DoctorNotification.js';
import { processDueReminders } from '../utils/notificationService.js';
import { tenantFilter } from '../utils/branchScope.js';
import { getUnreadCount } from '../utils/doctorNotify.js';
import { parsePagination, paginated } from '../utils/pagination.js';

/** Patient reminder delivery logs (not the doctor inbox). */
export const listMyNotifications = async (req, res) => {
  try {
    const filter = {};

    if (req.user.role === 'doctor') {
      const Appointment = (await import('../models/Appointment.js')).default;
      const apptIds = await Appointment.find({
        doctor: req.user._id,
        ...tenantFilter(req.user, req.branchId),
      }).distinct('_id');
      filter.appointmentId = { $in: apptIds };
    } else {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    if (req.query.status) filter.status = req.query.status;

    const { page, limit, skip } = parsePagination(req.query, { page: 1, limit: 20, max: 100 });
    const [notifications, total] = await Promise.all([
      NotificationLog.find(filter)
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'appointmentId',
          select: 'appointmentDate timeSlot status doctor patientId',
          populate: [
            { path: 'patientId', select: 'name phone patientCode' },
            { path: 'doctor', select: 'name' },
          ],
        }),
      NotificationLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      ...paginated({ items: notifications, total, page, limit }),
      notifications,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const runReminderPass = async (req, res) => {
  try {
    if (!['doctor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const processed = await processDueReminders();
    res.json({ success: true, processed });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Doctor in-app notification center */
export const listDoctorInbox = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Doctors only.' });
    }
    const filter = { doctorId: req.user._id };
    const { page, limit, skip } = parsePagination(req.query, { page: 1, limit: 20, max: 100 });
    const [notifications, total, unreadCount] = await Promise.all([
      DoctorNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      DoctorNotification.countDocuments(filter),
      getUnreadCount(req.user._id),
    ]);
    res.json({
      success: true,
      ...paginated({ items: notifications, total, page, limit }),
      notifications,
      unreadCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markInboxRead = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Doctors only.' });
    }
    const note = await DoctorNotification.findOne({
      _id: req.params.id,
      doctorId: req.user._id,
    });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }
    if (!note.readAt) {
      note.readAt = new Date();
      await note.save();
    }
    res.json({ success: true, notification: note });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markAllInboxRead = async (req, res) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Doctors only.' });
    }
    const result = await DoctorNotification.updateMany(
      { doctorId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ success: true, modified: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
