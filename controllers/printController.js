import PrintSettings from '../models/PrintSettings.js';
import Clinic from '../models/Clinic.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Prescription from '../models/Prescription.js';
import Consultation from '../models/Consultation.js';
import ConsentRecord from '../models/ConsentRecord.js';
import QueueTicket from '../models/QueueTicket.js';
import Appointment from '../models/Appointment.js';
import { asyncHandler } from '../middleware/access.js';
import { clinicQuery, assertSameClinic, assertBranchAccess } from '../utils/branchScope.js';
import { sanitizePrintHtml, PRINT_HTML_FIELDS } from '../utils/sanitizeHtml.js';
import { uploadImageBuffer, isCloudinaryConfigured } from '../utils/cloudinary.js';

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());
const isDataUrl = (value) => String(value || '').startsWith('data:image/');
const MAX_DATA_URL_CHARS = 500000;

function sanitizeImageField(value, fieldName) {
  if (value === undefined) return undefined;
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isHttpUrl(raw)) return raw;
  // Keep data URLs (dev / no Cloudinary) under a safe body size.
  if (isDataUrl(raw) && raw.length <= MAX_DATA_URL_CHARS) return raw;
  const err = new Error(
    `${fieldName} must be uploaded with the Upload button (Cloudinary or a small image), then Save.`
  );
  err.status = 400;
  throw err;
}

const ALLOWED_UPDATE = [
  'logo',
  'clinicName',
  'address',
  'phone',
  'email',
  'website',
  'appointmentPhone',
  'registrationNumber',
  'gstNumber',
  'taxLabel',
  'headerText',
  'footerText',
  'headerHtml',
  'footerHtml',
  'leftContentHtml',
  'rightContentHtml',
  'terms',
  'includeHeader',
  'includeFooter',
  'showLeftSignature',
  'showRightSignature',
  'leftSignatureText',
  'rightSignatureText',
  'signatureImage',
  'signatureLabel',
  'showSignature',
  'paperSize',
  'pageOrientation',
  'marginTopIn',
  'marginBottomIn',
  'marginLeftIn',
  'marginRightIn',
  'headingFontSize',
  'contentFontSize',
  'subContentFontSize',
  'showPoweredBy',
  'coloredPrint',
  'currency',
  'currencySymbol',
];

const brandingFrom = (clinic, settings) => ({
  logo: settings?.logo || clinic?.logo || '',
  clinicName: settings?.clinicName || clinic?.name || '',
  address: settings?.address || clinic?.address || '',
  phone: settings?.phone || clinic?.phone || '',
  email: settings?.email || clinic?.email || '',
  website: settings?.website || clinic?.website || '',
  appointmentPhone: settings?.appointmentPhone || '',
  registrationNumber: settings?.registrationNumber || clinic?.registrationNumber || '',
  gstNumber: settings?.gstNumber || clinic?.gstNumber || '',
  taxLabel: settings?.taxLabel || 'GST',
  headerText: settings?.headerText || '',
  footerText: settings?.footerText || '',
  headerHtml: sanitizePrintHtml(settings?.headerHtml || ''),
  footerHtml: sanitizePrintHtml(settings?.footerHtml || ''),
  leftContentHtml: sanitizePrintHtml(settings?.leftContentHtml || ''),
  rightContentHtml: sanitizePrintHtml(settings?.rightContentHtml || ''),
  terms: settings?.terms || '',
  includeHeader: settings?.includeHeader !== false,
  includeFooter: settings?.includeFooter !== false,
  showLeftSignature: Boolean(settings?.showLeftSignature),
  showRightSignature:
    settings?.showRightSignature !== false && settings?.showSignature !== false,
  leftSignatureText: settings?.leftSignatureText || '',
  rightSignatureText: settings?.rightSignatureText || '',
  signatureImage: settings?.signatureImage || '',
  signatureLabel: settings?.signatureLabel || 'Doctor signature',
  showSignature: settings?.showSignature !== false,
  paperSize: settings?.paperSize || 'A4',
  pageOrientation: settings?.pageOrientation || 'portrait',
  marginTopIn: settings?.marginTopIn ?? 0.5,
  marginBottomIn: settings?.marginBottomIn ?? 0.5,
  marginLeftIn: settings?.marginLeftIn ?? 0.5,
  marginRightIn: settings?.marginRightIn ?? 0.5,
  headingFontSize: settings?.headingFontSize ?? 14,
  contentFontSize: settings?.contentFontSize ?? 12,
  subContentFontSize: settings?.subContentFontSize ?? 11,
  showPoweredBy: Boolean(settings?.showPoweredBy),
  coloredPrint: settings?.coloredPrint !== false,
  currency: settings?.currency || clinic?.currency || 'INR',
  currencySymbol: settings?.currencySymbol || clinic?.currencySymbol || '₹',
});

export const getPrintSettings = asyncHandler(async (req, res) => {
  const clinic = await Clinic.findById(req.user.clinicId);
  let settings = await PrintSettings.findOne({ clinicId: req.user.clinicId });
  if (!settings && clinic) {
    settings = await PrintSettings.create({
      clinicId: clinic._id,
      clinicName: clinic.name,
      address: clinic.address,
      phone: clinic.phone,
      email: clinic.email,
      logo: clinic.logo,
    });
  }
  res.json({ success: true, settings: brandingFrom(clinic, settings), branding: brandingFrom(clinic, settings) });
});

export const updatePrintSettings = asyncHandler(async (req, res) => {
  const clinicId = req.user.clinicId;
  const patch = { clinicId };
  for (const key of ALLOWED_UPDATE) {
    if (req.body[key] === undefined) continue;
    if (key === 'logo' || key === 'signatureImage') {
      patch[key] = sanitizeImageField(req.body[key], key === 'logo' ? 'Logo' : 'Signature image');
      continue;
    }
    if (PRINT_HTML_FIELDS.includes(key)) {
      patch[key] = sanitizePrintHtml(req.body[key]);
      continue;
    }
    patch[key] = req.body[key];
  }
  const settings = await PrintSettings.findOneAndUpdate({ clinicId }, { $set: patch }, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });
  if (patch.logo !== undefined && isHttpUrl(patch.logo)) {
    await Clinic.findByIdAndUpdate(clinicId, { $set: { logo: patch.logo } }).catch(() => {});
  }
  const clinic = await Clinic.findById(clinicId);
  res.json({
    success: true,
    settings: brandingFrom(clinic, settings),
    message: 'Print settings saved',
  });
});

export const uploadPrintAsset = asyncHandler(async (req, res) => {
  const kind = String(req.body.kind || req.query.kind || '').toLowerCase();
  if (!['logo', 'signature'].includes(kind)) {
    return res.status(400).json({
      success: false,
      message: 'Upload kind must be "logo" or "signature".',
    });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ success: false, message: 'Choose an image file to upload.' });
  }

  const clinicId = String(req.user.clinicId);
  let url;
  if (isCloudinaryConfigured()) {
    const folder = `clinic-management/${clinicId}/print`;
    const publicId = kind === 'logo' ? 'clinic-logo' : 'doctor-signature';
    const result = await uploadImageBuffer(req.file.buffer, { folder, publicId });
    url = result.secure_url;
  } else {
    // Local/dev fallback when Cloudinary env vars are missing
    const mime = req.file.mimetype || 'image/jpeg';
    url = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    if (url.length > MAX_DATA_URL_CHARS) {
      return res.status(400).json({
        success: false,
        message:
          'Image is too large for local storage. Add CLOUDINARY_* to clinic-backend/.env or use a smaller image (under ~350 KB).',
      });
    }
  }

  const field = kind === 'logo' ? 'logo' : 'signatureImage';
  const settings = await PrintSettings.findOneAndUpdate(
    { clinicId: req.user.clinicId },
    { $set: { clinicId: req.user.clinicId, [field]: url } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (kind === 'logo') {
    await Clinic.findByIdAndUpdate(clinicId, { $set: { logo: url } }).catch(() => {});
  }

  const clinic = await Clinic.findById(clinicId);
  res.json({
    success: true,
    kind,
    url,
    settings: brandingFrom(clinic, settings),
    message: kind === 'logo' ? 'Logo uploaded.' : 'Signature uploaded.',
  });
});

export const printPreview = asyncHandler(async (req, res) => {
  const clinic = await Clinic.findById(req.user.clinicId);
  const settings = await PrintSettings.findOne({ clinicId: req.user.clinicId });
  const branding = brandingFrom(clinic, settings);
  res.json({
    success: true,
    type: 'preview',
    branding,
    preview: {
      title: 'Print preview',
      patientName: 'Sample Patient',
      doctorName: req.user.name || 'Doctor',
      dateLabel: new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      lines: [
        'This is a sample document using your saved letterhead, logo, margins, and signatures.',
        'Use Print / Save PDF to check how invoices, prescriptions, and slips will look.',
        'Edit Print Settings, then reopen this preview to verify changes.',
      ],
    },
  });
});

export const printPayload = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const clinic = await Clinic.findById(req.user.clinicId);
  const settings = await PrintSettings.findOne({ clinicId: req.user.clinicId });
  const branding = brandingFrom(clinic, settings);

  if (type === 'invoice') {
    const invoice = await Invoice.findById(id)
      .populate('patientId', 'name patientCode phone address')
      .populate('doctorId', 'name specialization qualification')
      .populate('branchId', 'name address phone');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    assertSameClinic(req.user, invoice.clinicId);
    assertBranchAccess(req.user, invoice.branchId);
    const payments = await Payment.find({ invoiceId: invoice._id, status: 'completed' });
    return res.json({ success: true, type, branding, invoice, payments });
  }

  if (type === 'receipt') {
    const payment = await Payment.findById(id).populate('receivedBy', 'name');
    if (!payment) return res.status(404).json({ success: false, message: 'Receipt not found.' });
    assertSameClinic(req.user, payment.clinicId);
    assertBranchAccess(req.user, payment.branchId);
    const invoice = await Invoice.findById(payment.invoiceId)
      .populate('patientId', 'name patientCode phone')
      .populate('doctorId', 'name')
      .populate('branchId', 'name');
    if (invoice) assertBranchAccess(req.user, invoice.branchId);
    return res.json({ success: true, type, branding, payment, invoice });
  }

  if (type === 'prescription') {
    const prescription = await Prescription.findById(id)
      .populate('patientId', 'name patientCode age gender phone')
      .populate('doctorId', 'name specialization qualification licenseNumber');
    if (!prescription) return res.status(404).json({ success: false, message: 'Prescription not found.' });
    assertSameClinic(req.user, prescription.clinicId);
    assertBranchAccess(req.user, prescription.branchId);
    return res.json({ success: true, type, branding, prescription });
  }

  if (type === 'consultation') {
    const consultation = await Consultation.findById(id)
      .populate('patientId', 'name patientCode age gender')
      .populate('doctorId', 'name specialization qualification');
    if (!consultation) return res.status(404).json({ success: false, message: 'Consultation not found.' });
    assertSameClinic(req.user, consultation.clinicId);
    assertBranchAccess(req.user, consultation.branchId);
    const prescription = await Prescription.findOne({ consultationId: consultation._id });
    return res.json({ success: true, type, branding, consultation, prescription });
  }

  if (type === 'consent') {
    const record = await ConsentRecord.findById(id)
      .populate('patientId', 'name patientCode')
      .populate('doctorId', 'name');
    if (!record) return res.status(404).json({ success: false, message: 'Consent not found.' });
    assertSameClinic(req.user, record.clinicId);
    assertBranchAccess(req.user, record.branchId);
    return res.json({ success: true, type, branding, record });
  }

  if (type === 'queue_token') {
    const ticket = await QueueTicket.findById(id).populate('patientId', 'name').populate('branchId', 'name roomLabel');
    if (!ticket) return res.status(404).json({ success: false, message: 'Token not found.' });
    assertSameClinic(req.user, ticket.clinicId);
    assertBranchAccess(req.user, ticket.branchId);
    return res.json({ success: true, type, branding, ticket });
  }

  if (type === 'appointment_slip') {
    const appointment = await Appointment.findById(id)
      .populate('patientId', 'name patientCode phone')
      .populate('doctor', 'name specialization')
      .populate('branchId', 'name address phone');
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    assertSameClinic(req.user, appointment.clinicId);
    assertBranchAccess(req.user, appointment.branchId);
    return res.json({ success: true, type, branding, appointment });
  }

  return res.status(400).json({ success: false, message: 'Unknown print type.' });
});

void clinicQuery;
