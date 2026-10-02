import ClinicalTemplate from '../models/ClinicalTemplate.js';
import { asyncHandler } from '../middleware/access.js';
import {
  clinicQuery,
  assertSameClinic,
  assertBranchAccess,
  tenantFilter,
  resolveWriteBranchId,
} from '../utils/branchScope.js';
import { hasPermission, P } from '../utils/permissions.js';
import { seedClinicTemplates } from '../utils/migrateV2.js';
import { parsePagination, paginated } from '../utils/pagination.js';

export const listTemplates = asyncHandler(async (req, res) => {
  const clinicId = req.user.clinicId;
  if (clinicId) {
    const existing = await ClinicalTemplate.countDocuments({
      clinicId,
      isActive: true,
      ...tenantFilter(req.user, req.branchId),
    });
    if (existing === 0) {
      const branchId = await resolveWriteBranchId(req.user, req.branchId).catch(() => null);
      await seedClinicTemplates(clinicId, branchId);
    }
  }

  const clinic = clinicQuery(req.user);
  const branch = tenantFilter(req.user, req.branchId);
  const or = [{ ownerType: 'clinic', ...clinic, ...branch }];

  if (req.user.role === 'doctor') {
    or.push({ ownerType: 'doctor', doctorId: req.user._id, ...clinic, ...branch });
  } else if (hasPermission(req.user, P.TEMPLATES_CLINIC)) {
    // Clinic managers can see every private template for editing (within branch scope).
    or.push({ ownerType: 'doctor', ...clinic, ...branch });
  } else if (hasPermission(req.user, P.TEMPLATES_OWN)) {
    // Staff with own-only: their templates (if any), never other doctors' private ones.
    or.push({ ownerType: 'doctor', doctorId: req.user._id, ...clinic, ...branch });
  }
  // CONSULTATION-only callers get clinic-shared templates only (or above).

  const filter = { $or: or };
  if (req.query.active === 'all') {
    // include inactive
  } else if (req.query.active === 'false') {
    filter.isActive = false;
  } else {
    filter.isActive = true;
  }
  if (req.query.type) filter.type = req.query.type;
  if (req.query.q?.trim()) {
    filter.name = new RegExp(String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const { page, limit, skip } = parsePagination(req.query, { limit: 10 });
  const [total, templates] = await Promise.all([
    ClinicalTemplate.countDocuments(filter),
    ClinicalTemplate.find(filter)
      .sort({ isActive: -1, ownerType: 1, name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  res.json({ success: true, ...paginated({ items: templates, total, page, limit }), templates });
});

export const createTemplate = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(422).json({ success: false, message: 'Template name is required.' });
  }
  const ownerType = req.body.ownerType === 'clinic' ? 'clinic' : 'doctor';
  if (ownerType === 'clinic' && !hasPermission(req.user, P.TEMPLATES_CLINIC)) {
    return res.status(403).json({ success: false, message: 'Cannot create clinic-wide templates.' });
  }
  const branchId = await resolveWriteBranchId(req.user, req.branchId);
  const template = await ClinicalTemplate.create({
    clinicId: req.user.clinicId,
    branchId,
    doctorId: ownerType === 'doctor' ? req.user._id : null,
    ownerType,
    type: req.body.type || 'consultation',
    name,
    fields: req.body.fields || {},
  });
  res.status(201).json({ success: true, template });
});

export const updateTemplate = asyncHandler(async (req, res) => {
  const template = await ClinicalTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
  assertSameClinic(req.user, template.clinicId);
  assertBranchAccess(req.user, template.branchId);
  if (
    template.ownerType === 'doctor' &&
    String(template.doctorId) !== String(req.user._id) &&
    !hasPermission(req.user, P.TEMPLATES_CLINIC)
  ) {
    return res.status(403).json({ success: false, message: 'You can only edit your own templates.' });
  }
  if (req.body.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(422).json({ success: false, message: 'Template name is required.' });
    template.name = name;
  }
  if (req.body.type) template.type = req.body.type;
  if (req.body.fields) template.fields = { ...template.fields.toObject?.() || template.fields, ...req.body.fields };
  if (req.body.isActive !== undefined) template.isActive = Boolean(req.body.isActive);
  if (req.body.ownerType && hasPermission(req.user, P.TEMPLATES_CLINIC)) {
    const next = req.body.ownerType === 'clinic' ? 'clinic' : 'doctor';
    template.ownerType = next;
    template.doctorId = next === 'doctor' ? template.doctorId || req.user._id : null;
  }
  // Keep template on its branch unless actor can assign and supplies a branch (header already scoped).
  if (!template.branchId) {
    template.branchId = await resolveWriteBranchId(req.user, req.branchId);
  }
  await template.save();
  res.json({ success: true, template });
});
