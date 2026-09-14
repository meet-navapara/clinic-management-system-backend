import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';
import Medicine from '../models/Medicine.js';
import { asyncHandler } from '../middleware/access.js';
import { clinicQuery, tenantFilter } from '../utils/branchScope.js';
import { escapeRegex } from '../utils/pagination.js';
import { hasPermission, P } from '../utils/permissions.js';

export const globalSearch = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, results: {} });

  const rx = new RegExp(escapeRegex(q), 'i');
  const clinic = clinicQuery(req.user);
  const branch = tenantFilter(req.user, req.branchId);
  const isDoctor = req.user.role === 'doctor';

  const patientScope = {
    ...branch,
    isActive: true,
    ...(isDoctor ? { doctorId: req.user._id } : {}),
  };

  const matchingPatients = hasPermission(req.user, P.PATIENTS_VIEW)
    ? await Patient.find({
        ...patientScope,
        $or: [{ name: rx }, { phone: rx }, { patientCode: rx }, { email: rx }, { tags: rx }],
      })
        .select('_id')
        .limit(40)
    : [];
  const patientIds = matchingPatients.map((p) => p._id);

  const tasks = {};

  if (hasPermission(req.user, P.PATIENTS_VIEW)) {
    tasks.patients = Patient.find({
      ...patientScope,
      $or: [{ name: rx }, { phone: rx }, { patientCode: rx }, { email: rx }, { tags: rx }],
    })
      .select('name patientCode phone tags')
      .limit(8);
  }

  if (hasPermission(req.user, P.APPOINTMENTS_VIEW)) {
    tasks.appointments = Appointment.find({
      ...branch,
      ...(isDoctor ? { doctor: req.user._id } : {}),
      $or: [{ reason: rx }, { appointmentType: rx }, { timeSlot: rx }, { patientId: { $in: patientIds } }],
    })
      .populate('patientId', 'name phone')
      .sort({ appointmentDate: -1 })
      .limit(8);
  }

  if (hasPermission(req.user, P.BILLING_VIEW)) {
    const invoiceFilter = {
      ...branch,
      ...(isDoctor && !hasPermission(req.user, P.REVENUE_ALL) ? { doctorId: req.user._id } : {}),
      $or: [{ invoiceNumber: rx }, ...(patientIds.length ? [{ patientId: { $in: patientIds } }] : [])],
    };
    tasks.invoices = Invoice.find(invoiceFilter)
      .select('invoiceNumber total paymentStatus invoiceDate patientId')
      .populate('patientId', 'name')
      .limit(8);
  }

  if (hasPermission(req.user, P.STAFF_MANAGE)) {
    tasks.staff = User.find({
      ...clinic,
      role: { $ne: 'patient' },
      $or: [{ name: rx }, { email: rx }, { phone: rx }, { specialization: rx }],
    })
      .select('name role email specialization')
      .limit(8);
  } else if (hasPermission(req.user, P.PATIENTS_VIEW) || hasPermission(req.user, P.APPOINTMENTS_VIEW)) {
    // Branch staff may look up clinic doctors only — not the full staff directory.
    tasks.staff = User.find({
      ...clinic,
      role: 'doctor',
      isActive: { $ne: false },
      $or: [{ name: rx }, { email: rx }, { phone: rx }, { specialization: rx }],
    })
      .select('name role email specialization')
      .limit(8);
  }

  if (hasPermission(req.user, P.MEDICINE_USE) || hasPermission(req.user, P.MEDICINE_MANAGE)) {
    tasks.medicines = Medicine.find({
      ...clinic,
      isActive: true,
      $or: [{ name: rx }, { genericName: rx }, { category: rx }],
    })
      .select('name genericName strength dosageForm')
      .limit(8);
  }

  const keys = Object.keys(tasks);
  const values = await Promise.all(keys.map((k) => tasks[k]));
  const results = {};
  keys.forEach((k, i) => {
    results[k] = values[i];
  });
  res.json({ success: true, results });
});
