import User from '../models/User.js';
import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import Clinic from '../models/Clinic.js';
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
    const [
      totalDoctors,
      pendingDoctors,
      approvedDoctors,
      suspendedDoctors,
      rejectedDoctors,
      disabledStaff,
    ] = await Promise.all([
      User.countDocuments(base),
      User.countDocuments({ ...base, approvalStatus: 'pending' }),
      User.countDocuments({ ...base, approvalStatus: 'approved' }),
      User.countDocuments({ ...base, approvalStatus: 'suspended' }),
      User.countDocuments({ ...base, approvalStatus: 'rejected' }),
      User.countDocuments({
        role: { $nin: ['super_admin', 'doctor'] },
        $or: [{ staffStatus: { $in: ['inactive', 'suspended'] } }, { isActive: false }],
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
        staff: {
          disabled: disabledStaff,
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
    const { status, specialization, search, page = 1, limit = 20 } = req.query;

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
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
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
    if (status === 'approved') {
      doctor.isActive = true;
      doctor.staffStatus = 'active';
    }
    if (status === 'rejected' || status === 'suspended') {
      doctor.isActive = false;
      doctor.staffStatus = 'inactive';
    }
    if (status === 'pending') {
      doctor.isActive = true;
      doctor.staffStatus = 'active';
    }
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

const DISABLED_STAFF_FILTER = {
  role: { $nin: ['super_admin', 'doctor'] },
  $or: [{ staffStatus: { $in: ['inactive', 'suspended'] } }, { isActive: false }],
};

export const listDisabledStaff = async (req, res) => {
  try {
    const { search } = req.query;
    const filter = { ...DISABLED_STAFF_FILTER };
    if (search?.trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$and = [
        { $or: DISABLED_STAFF_FILTER.$or },
        {
          $or: [
            { name: new RegExp(q, 'i') },
            { email: new RegExp(q, 'i') },
            { phone: new RegExp(q, 'i') },
          ],
        },
      ];
      delete filter.$or;
    }

    const staff = await User.find(filter)
      .select('-password')
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate('clinicId', 'name')
      .populate('defaultBranchId', 'name');

    res.json({
      success: true,
      staff: staff.map((row) => {
        const payload = toAuthUser(row);
        const clinic = row.clinicId;
        return {
          ...payload,
          clinicName:
            (clinic && typeof clinic === 'object' && clinic.name) || payload.clinicName || '—',
          staffTypeLabel: (payload.staffType || payload.role || 'staff').replace(/_/g, ' '),
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const setStaffApproval = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be approved or rejected.',
      });
    }

    const staff = await User.findOne({
      _id: req.params.id,
      role: { $nin: ['super_admin', 'doctor'] },
    });
    if (!staff) {
      return res.status(404).json({ success: false, message: 'Staff not found.' });
    }

    if (status === 'approved') {
      staff.staffStatus = 'active';
      staff.isActive = true;
    } else {
      staff.staffStatus = 'inactive';
      staff.isActive = false;
    }
    await staff.save();

    res.json({
      success: true,
      message: status === 'approved' ? 'Staff approved.' : 'Staff kept disabled.',
      staff: toAuthUser(staff),
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

/** Super Admin: clinics waiting for MSG91 campaign template approval */
export const listCampaignWhatsAppTemplates = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const filter =
      status === 'all'
        ? { 'whatsappCampaignTemplate.status': { $in: ['pending', 'approved', 'rejected'] } }
        : { 'whatsappCampaignTemplate.status': status };

    const clinics = await Clinic.find(filter)
      .select('name slug phone email whatsappCampaignTemplate updatedAt')
      .populate('whatsappCampaignTemplate.submittedBy', 'name email')
      .populate('whatsappCampaignTemplate.reviewedBy', 'name email')
      .sort({ 'whatsappCampaignTemplate.submittedAt': -1 })
      .limit(100);

    res.json({
      success: true,
      clinics: clinics.map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        phone: c.phone,
        email: c.email,
        template: c.whatsappCampaignTemplate,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Super Admin approves after creating the template on MSG91 and Meta shows Approved.
 * Body: { action: 'approve'|'reject', approvedName?, approvedBodyVars?, reviewNote? }
 */
export const reviewCampaignWhatsAppTemplate = async (req, res) => {
  try {
    const clinic = await Clinic.findById(req.params.clinicId);
    if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found.' });

    const tpl = clinic.whatsappCampaignTemplate;
    if (!tpl || tpl.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This clinic has no pending campaign WhatsApp template.',
      });
    }

    const action = String(req.body.action || '').toLowerCase();
    if (action === 'reject') {
      clinic.whatsappCampaignTemplate.status = 'rejected';
      clinic.whatsappCampaignTemplate.reviewNote = String(req.body.reviewNote || 'Rejected').slice(0, 500);
      clinic.whatsappCampaignTemplate.reviewedAt = new Date();
      clinic.whatsappCampaignTemplate.reviewedBy = req.user._id;
      clinic.whatsappCampaignTemplate.approvedName = '';
      clinic.whatsappCampaignTemplate.approvedBodyVars = '';
      await clinic.save();
      return res.json({
        success: true,
        message: 'Template rejected. Doctor can submit again.',
        template: clinic.whatsappCampaignTemplate,
      });
    }

    if (action !== 'approve') {
      return res.status(422).json({ success: false, message: 'action must be approve or reject.' });
    }

    const approvedName = String(req.body.approvedName || tpl.requestedName || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const approvedBodyVars = String(
      req.body.approvedBodyVars || tpl.requestedBodyVars || 'patientName,clinicName,_message'
    ).trim();

    if (!approvedName) {
      return res.status(422).json({
        success: false,
        message: 'Enter the exact MSG91 template name that Meta approved.',
      });
    }

    clinic.whatsappCampaignTemplate.status = 'approved';
    clinic.whatsappCampaignTemplate.approvedName = approvedName;
    clinic.whatsappCampaignTemplate.approvedBodyVars = approvedBodyVars;
    clinic.whatsappCampaignTemplate.reviewNote = String(req.body.reviewNote || 'Approved on MSG91').slice(0, 500);
    clinic.whatsappCampaignTemplate.reviewedAt = new Date();
    clinic.whatsappCampaignTemplate.reviewedBy = req.user._id;
    await clinic.save();

    res.json({
      success: true,
      message: `Approved. Clinic can now send WhatsApp campaigns with template “${approvedName}”.`,
      template: clinic.whatsappCampaignTemplate,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
