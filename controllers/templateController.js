import ClinicalTemplate from '../models/ClinicalTemplate.js';
import { asyncHandler } from '../middleware/access.js';
import { clinicQuery, assertSameClinic } from '../utils/branchScope.js';
import { hasPermission, P } from '../utils/permissions.js';
import { seedClinicTemplates } from '../utils/migrateV2.js';

export const listTemplates = asyncHandler(async (req, res) => {
  const clinicId = req.user.clinicId;
  if (clinicId) {
    const existing = await ClinicalTemplate.countDocuments({ clinicId, isActive: true });
    if (existing === 0) {
      await seedClinicTemplates(clinicId);
    }
  }

  const clinic = clinicQuery(req.user);
  const or = [{ ownerType: 'clinic', ...clinic }];
  if (req.user.role === 'doctor') {
    or.push({ ownerType: 'doctor', doctorId: req.user._id, ...clinic });
  } else {
    or.push({ ownerType: 'doctor', ...clinic });
  }
  const filter = { isActive: true, $or: or };
  if (req.query.type) filter.type = req.query.type;
  const templates = await ClinicalTemplate.find(filter).sort({ ownerType: 1, name: 1 }).lean();
  res.json({ success: true, templates });
});

export const createTemplate = asyncHandler(async (req, res) => {
  const ownerType = req.body.ownerType === 'clinic' ? 'clinic' : 'doctor';
  if (ownerType === 'clinic' && !hasPermission(req.user, P.TEMPLATES_CLINIC)) {
    return res.status(403).json({ success: false, message: 'Cannot create clinic-wide templates.' });
  }
  const template = await ClinicalTemplate.create({
    clinicId: req.user.clinicId,
    doctorId: ownerType === 'doctor' ? req.user._id : null,
    ownerType,
    type: req.body.type || 'consultation',
    name: req.body.name,
    fields: req.body.fields || {},
  });
  res.status(201).json({ success: true, template });
});

export const updateTemplate = asyncHandler(async (req, res) => {
  const template = await ClinicalTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
  assertSameClinic(req.user, template.clinicId);
  if (template.ownerType === 'doctor' && String(template.doctorId) !== String(req.user._id) && !hasPermission(req.user, P.TEMPLATES_CLINIC)) {
    return res.status(403).json({ success: false, message: 'You can only edit your own templates.' });
  }
  if (req.body.name) template.name = req.body.name;
  if (req.body.type) template.type = req.body.type;
  if (req.body.fields) template.fields = { ...template.fields, ...req.body.fields };
  if (req.body.isActive !== undefined) template.isActive = req.body.isActive;
  await template.save();
  res.json({ success: true, template });
});
