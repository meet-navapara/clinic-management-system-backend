import ConsentTemplate from '../models/ConsentTemplate.js';
import ConsentRecord from '../models/ConsentRecord.js';
import Patient from '../models/Patient.js';
import { asyncHandler } from '../middleware/access.js';
import { clinicQuery, tenantFilter, assertSameClinic, assertBranchAccess } from '../utils/branchScope.js';
import { parsePagination, paginated } from '../utils/pagination.js';
import { writeAudit, AUDIT } from '../utils/audit.js';
import { recordPatientEvent } from '../utils/patientTimeline.js';

export const listConsentTemplates = asyncHandler(async (req, res) => {
  const filter = { ...clinicQuery(req.user) };
  if (req.query.active !== 'all') filter.isActive = true;
  const templates = await ConsentTemplate.find(filter).sort({ name: 1 });
  res.json({ success: true, templates });
});

export const createConsentTemplate = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const body = String(req.body.body || '').trim();
  if (!name) return res.status(422).json({ success: false, message: 'Template name is required.' });
  if (!body) return res.status(422).json({ success: false, message: 'Consent text is required.' });
  const template = await ConsentTemplate.create({
    clinicId: req.user.clinicId,
    name,
    category: req.body.category || 'general',
    body,
    version: 1,
  });
  res.status(201).json({ success: true, template });
});

export const updateConsentTemplate = asyncHandler(async (req, res) => {
  const template = await ConsentTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
  assertSameClinic(req.user, template.clinicId);
  const bump = req.body.body && req.body.body !== template.body;
  if (req.body.name) template.name = req.body.name;
  if (req.body.category) template.category = req.body.category;
  if (req.body.body) template.body = req.body.body;
  if (req.body.isActive !== undefined) template.isActive = req.body.isActive;
  if (bump) template.version = (template.version || 1) + 1;
  await template.save();
  res.json({ success: true, template });
});

export const assignConsent = asyncHandler(async (req, res) => {
  const template = await ConsentTemplate.findById(req.body.consentTemplateId);
  if (!template || !template.isActive) {
    return res.status(404).json({ success: false, message: 'Consent template not found.' });
  }
  assertSameClinic(req.user, template.clinicId);
  const patient = await Patient.findById(req.body.patientId);
  if (!patient || !patient.isActive) return res.status(404).json({ success: false, message: 'Patient not found.' });
  assertSameClinic(req.user, patient.clinicId);
  assertBranchAccess(req.user, patient.branchId);

  const record = await ConsentRecord.create({
    clinicId: patient.clinicId,
    branchId: patient.branchId || req.branchId,
    consentTemplateId: template._id,
    patientId: patient._id,
    doctorId: req.body.doctorId || patient.doctorId,
    appointmentId: req.body.appointmentId || null,
    version: template.version,
    titleSnapshot: template.name,
    bodySnapshot: template.body,
    status: 'pending',
    capturedBy: req.user._id,
  });
  res.status(201).json({ success: true, record });
});

export const signConsent = asyncHandler(async (req, res) => {
  const record = await ConsentRecord.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Consent record not found.' });
  assertSameClinic(req.user, record.clinicId);
  assertBranchAccess(req.user, record.branchId);
  if (record.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'This consent is already completed.' });
  }
  const status = req.body.status === 'rejected' ? 'rejected' : 'accepted';
  const signature = String(req.body.signatureDataUrl || '');
  if (status === 'accepted' && !signature) {
    return res.status(400).json({ success: false, message: 'Signature is required to accept consent.' });
  }
  if (signature && !signature.startsWith('data:image/')) {
    return res.status(400).json({ success: false, message: 'Signature must be an image data URL.' });
  }
  if (signature.length > 200000) {
    return res.status(400).json({ success: false, message: 'Signature image is too large.' });
  }
  record.status = status;
  record.signedAt = new Date();
  record.signatureDataUrl = signature;
  record.signerName = String(req.body.signerName || '').slice(0, 120);
  record.ipAddress = req.ip || '';
  await record.save();

  if (status === 'accepted') {
    await writeAudit({
      clinicId: record.clinicId,
      branchId: record.branchId,
      actorId: req.user._id,
      action: AUDIT.CONSENT_SIGNED,
      entityType: 'ConsentRecord',
      entityId: record._id,
      detail: record.titleSnapshot,
    });
    await recordPatientEvent({
      clinicId: record.clinicId,
      doctorId: record.doctorId,
      patientId: record.patientId,
      type: 'consent_signed',
      title: 'Consent signed',
      detail: record.titleSnapshot,
      appointmentId: record.appointmentId,
    });
  }
  res.json({ success: true, record });
});

export const listConsentRecords = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = tenantFilter(req.user, req.branchId);
  if (req.query.patientId) filter.patientId = req.query.patientId;
  if (req.query.status) filter.status = req.query.status;
  const [rows, total] = await Promise.all([
    ConsentRecord.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('patientId', 'name patientCode')
      .populate('doctorId', 'name'),
    ConsentRecord.countDocuments(filter),
  ]);
  res.json({ success: true, ...paginated({ items: rows, total, page, limit }), records: rows });
});

export const getConsentRecord = asyncHandler(async (req, res) => {
  const record = await ConsentRecord.findById(req.params.id)
    .populate('patientId', 'name patientCode phone')
    .populate('doctorId', 'name');
  if (!record) return res.status(404).json({ success: false, message: 'Consent record not found.' });
  assertSameClinic(req.user, record.clinicId);
  assertBranchAccess(req.user, record.branchId);
  res.json({ success: true, record });
});
