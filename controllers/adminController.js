import User from '../models/User.js';
import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import { toAuthUser } from '../utils/authUser.js';
import { isSameClinic } from '../middleware/auth.js';
import { notifyDoctor } from '../utils/doctorNotify.js';
import { ACTIVE_APPOINTMENT_STATUSES } from '../models/Appointment.js';
import { normalizeStatus } from '../utils/appointmentTransitions.js';

const doctorFilter = (req) => {
  const filter = { role: 'doctor' };
  if (req.user.role !== 'super_admin') {
    filter.clinicId = req.user.clinicId;
  }
  return filter;
};

export const getAdminDashboard = async (req, res) => {
  try {
    const base = doctorFilter(req);
    const patientFilter =
      req.user.role === 'super_admin' ? { isActive: true } : { clinicId: req.user.clinicId, isActive: true };
    const apptFilter =
      req.user.role === 'super_admin' ? {} : { clinicId: req.user.clinicId };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [
      totalDoctors,
      pendingDoctors,
      approvedDoctors,
      suspendedDoctors,
      rejectedDoctors,
      totalPatients,
      totalAppointments,
      upcomingAppointments,
      todayAppointments,
    ] = await Promise.all([
      User.countDocuments(base),
      User.countDocuments({ ...base, approvalStatus: 'pending' }),
      User.countDocuments({ ...base, approvalStatus: 'approved' }),
      User.countDocuments({ ...base, approvalStatus: 'suspended' }),
      User.countDocuments({ ...base, approvalStatus: 'rejected' }),
      Patient.countDocuments(patientFilter),
      Appointment.countDocuments(apptFilter),
      Appointment.countDocuments({
        ...apptFilter,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        appointmentDate: { $gte: todayStart },
      }),
      Appointment.countDocuments({
        ...apptFilter,
        appointmentDate: { $gte: todayStart, $lt: todayEnd },
      }),
    ]);

    res.json({
      success: true,
      stats: {
        doctors: {
          total: totalDoctors,
          pending: pendingDoctors,
          approved: approvedDoctors,
          suspended: suspendedDoctors,
          rejected: rejectedDoctors,
        },
        patients: { total: totalPatients },
        appointments: {
          total: totalAppointments,
          upcoming: upcomingAppointments,
          today: todayAppointments,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listClinicDoctors = async (req, res) => {
  try {
    const filter = doctorFilter(req);
    const { status, specialization, search, page = 1, limit = 50 } = req.query;

    if (status) filter.approvalStatus = status;
    if (specialization) {
      filter.specialization = { $regex: String(specialization), $options: 'i' };
    }
    if (search?.trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { phone: new RegExp(q, 'i') },
        { specialization: new RegExp(q, 'i') },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [doctors, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      User.countDocuments(filter),
    ]);

    const doctorIds = doctors.map((d) => d._id);
    const [patientCounts, apptCounts] = await Promise.all([
      Patient.aggregate([
        { $match: { doctorId: { $in: doctorIds }, isActive: true } },
        { $group: { _id: '$doctorId', count: { $sum: 1 } } },
      ]),
      Appointment.aggregate([
        { $match: { doctor: { $in: doctorIds } } },
        { $group: { _id: '$doctor', count: { $sum: 1 } } },
      ]),
    ]);

    const patientMap = Object.fromEntries(patientCounts.map((r) => [String(r._id), r.count]));
    const apptMap = Object.fromEntries(apptCounts.map((r) => [String(r._id), r.count]));

    res.json({
      success: true,
      count: doctors.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      doctors: doctors.map((d) => ({
        ...toAuthUser(d),
        patientCount: patientMap[String(d._id)] || 0,
        appointmentCount: apptMap[String(d._id)] || 0,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDoctorDetail = async (req, res) => {
  try {
    const doctor = await User.findOne({ _id: req.params.id, role: 'doctor' }).select('-password');
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }
    if (req.user.role !== 'super_admin' && !isSameClinic(req.user, doctor.clinicId)) {
      return res.status(403).json({ success: false, message: 'Doctor is outside your clinic.' });
    }

    const [patientCount, appointmentCount, upcomingCount] = await Promise.all([
      Patient.countDocuments({ doctorId: doctor._id, isActive: true }),
      Appointment.countDocuments({ doctor: doctor._id }),
      Appointment.countDocuments({
        doctor: doctor._id,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        appointmentDate: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
    ]);

    res.json({
      success: true,
      doctor: toAuthUser(doctor),
      activity: { patientCount, appointmentCount, upcomingCount },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const setDoctorApproval = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be approved, rejected, pending, or suspended.',
      });
    }

    const doctor = await User.findOne({ _id: req.params.id, role: 'doctor' });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    if (req.user.role !== 'super_admin' && !isSameClinic(req.user, doctor.clinicId)) {
      return res.status(403).json({ success: false, message: 'Doctor is outside your clinic.' });
    }

    doctor.approvalStatus = status;
    if (status === 'approved') doctor.isActive = true;
    if (status === 'rejected' || status === 'suspended') doctor.isActive = false;
    if (status === 'pending') doctor.isActive = true;
    await doctor.save();

    const notifyType =
      status === 'approved'
        ? 'account_approved'
        : status === 'rejected'
          ? 'account_rejected'
          : status === 'suspended'
            ? 'account_suspended'
            : 'system';

    await notifyDoctor({
      doctorId: doctor._id,
      clinicId: doctor.clinicId,
      type: notifyType,
      title: `Account ${status}`,
      body:
        status === 'approved'
          ? 'You can now access your doctor dashboard.'
          : `Your account status is now ${status}.`,
      link: status === 'approved' ? '/doctor/dashboard' : '/doctor/pending',
    });

    res.json({
      success: true,
      message: `Doctor ${status}.`,
      doctor: toAuthUser(doctor),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getClinicOverviewAppointments = async (req, res) => {
  try {
    const filter =
      req.user.role === 'super_admin' ? {} : { clinicId: req.user.clinicId };
    const appointments = await Appointment.find(filter)
      .sort({ appointmentDate: -1 })
      .limit(20)
      .populate('doctor', 'name specialization')
      .populate('patientId', 'name patientCode phone');

    res.json({
      success: true,
      appointments: appointments.map((a) => ({
        ...a.toObject(),
        status: normalizeStatus(a.status),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
