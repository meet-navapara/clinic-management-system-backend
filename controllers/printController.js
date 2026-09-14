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

const brandingFrom = (clinic, settings) => ({
  logo: settings?.logo || clinic?.logo || '',
  clinicName: settings?.clinicName || clinic?.name || '',
  address: settings?.address || clinic?.address || '',
  phone: settings?.phone || clinic?.phone || '',
  email: settings?.email || clinic?.email || '',
  website: settings?.website || clinic?.website || '',
  registrationNumber: settings?.registrationNumber || clinic?.registrationNumber || '',
  gstNumber: settings?.gstNumber || clinic?.gstNumber || '',
  taxLabel: settings?.taxLabel || 'GST',
  headerText: settings?.headerText || '',
  footerText: settings?.footerText || '',
  terms: settings?.terms || '',
  showSignature: settings?.showSignature !== false,
  signatureLabel: settings?.signatureLabel || 'Doctor signature',
  paperSize: settings?.paperSize || 'A4',
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
  res.json({ success: true, settings, branding: brandingFrom(clinic, settings) });
});

export const updatePrintSettings = asyncHandler(async (req, res) => {
  const clinicId = req.user.clinicId;
  const updates = { ...req.body, clinicId };
  delete updates._id;
  const settings = await PrintSettings.findOneAndUpdate({ clinicId }, updates, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });
  res.json({ success: true, settings });
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
