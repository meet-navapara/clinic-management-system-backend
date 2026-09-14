import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Patient from '../models/Patient.js';
import User from '../models/User.js';
import Clinic from '../models/Clinic.js';
import Branch from '../models/Branch.js';
import { nextSequence } from '../models/Counter.js';
import { computeInvoiceTotals, paymentStatusFromAmounts, roundMoney } from '../utils/money.js';
import { parsePagination, paginated, escapeRegex } from '../utils/pagination.js';
import { tenantFilter, assertSameClinic, assertBranchAccess, resolveWriteBranchId } from '../utils/branchScope.js';
import { deductInvoiceStock, reverseInvoiceStock } from '../utils/inventoryStock.js';
import { writeAudit, AUDIT } from '../utils/audit.js';
import { recordPatientEvent } from '../utils/patientTimeline.js';
import { hasPermission, P } from '../utils/permissions.js';
import { asyncHandler } from '../middleware/access.js';

const POPULATE = [
  { path: 'patientId', select: 'name patientCode phone email' },
  { path: 'doctorId', select: 'name specialization consultationFee' },
  { path: 'branchId', select: 'name code' },
  { path: 'createdBy', select: 'name role' },
];

const pad = (n, size = 5) => String(n).padStart(size, '0');

async function nextInvoiceNumber(clinicId) {
  const seq = await nextSequence(`invoice:${clinicId}`);
  const year = new Date().getFullYear();
  return `INV-${year}-${pad(seq)}`;
}

async function nextReceiptNumber(clinicId) {
  const seq = await nextSequence(`receipt:${clinicId}`);
  return `RCP-${pad(seq)}`;
}

async function refreshInvoicePayment(invoice) {
  const payments = await Payment.find({ invoiceId: invoice._id, status: { $in: ['completed', 'refunded'] } });
  let paid = 0;
  let refunded = 0;
  for (const p of payments) {
    if (p.status === 'refunded') refunded = roundMoney(refunded + p.amount);
    else paid = roundMoney(paid + p.amount);
  }
  const derived = paymentStatusFromAmounts(invoice.total, paid, refunded);
  invoice.paidAmount = derived.paidAmount;
  invoice.dueAmount = derived.dueAmount;
  invoice.refundedAmount = refunded;
  invoice.paymentStatus = derived.paymentStatus;
  await invoice.save();
  return invoice;
}

const loadInvoice = async (req, id) => {
  const invoice = await Invoice.findById(id);
  if (!invoice) {
    const err = new Error('Invoice not found.');
    err.status = 404;
    throw err;
  }
  assertSameClinic(req.user, invoice.clinicId);
  assertBranchAccess(req.user, invoice.branchId);
  if (req.user.role === 'doctor' && invoice.doctorId && String(invoice.doctorId) !== String(req.user._id)) {
    if (!hasPermission(req.user, P.REVENUE_ALL)) {
      const err = new Error('You can only view your own invoices.');
      err.status = 403;
      throw err;
    }
  }
  return invoice;
};

export const listInvoices = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = tenantFilter(req.user, req.branchId);
  if (req.query.status) filter.paymentStatus = req.query.status;
  if (req.query.patientId) filter.patientId = req.query.patientId;
  if (req.query.doctorId) filter.doctorId = req.query.doctorId;
  if (req.user.role === 'doctor' && !hasPermission(req.user, P.REVENUE_ALL)) {
    filter.doctorId = req.user._id;
  }
  if (req.query.q?.trim()) {
    const q = escapeRegex(req.query.q.trim());
    filter.$or = [{ invoiceNumber: new RegExp(q, 'i') }];
  }
  if (req.query.from || req.query.to) {
    filter.invoiceDate = {};
    if (req.query.from) filter.invoiceDate.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      filter.invoiceDate.$lte = to;
    }
  }

  const [rows, total] = await Promise.all([
    Invoice.find(filter).sort({ invoiceDate: -1 }).skip(skip).limit(limit).populate(POPULATE),
    Invoice.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated({ items: rows, total, page, limit }), invoices: rows });
});

export const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  await invoice.populate(POPULATE);
  const payments = await Payment.find({ invoiceId: invoice._id }).sort({ paymentDate: -1 }).populate('receivedBy', 'name');
  res.json({ success: true, invoice, payments });
});

export const createInvoice = asyncHandler(async (req, res) => {
  const { patientId, doctorId, appointmentId, items = [], discount = 0, taxRate, notes } = req.body;
  if (!patientId) {
    return res.status(400).json({ success: false, message: 'patientId is required.' });
  }
  const patient = await Patient.findById(patientId);
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });
  assertSameClinic(req.user, patient.clinicId);
  assertBranchAccess(req.user, patient.branchId);

  const clinic = await Clinic.findById(patient.clinicId);
  const rate = taxRate != null ? Number(taxRate) : clinic?.taxEnabled ? clinic.taxRate || 0 : 0;
  const totals = computeInvoiceTotals({ items, discount, taxRate: rate });
  const branchId = await resolveWriteBranchId(req.user, patient.branchId || req.branchId);
  const invoiceNumber = await nextInvoiceNumber(patient.clinicId);

  const invoice = await Invoice.create({
    invoiceNumber,
    clinicId: patient.clinicId,
    branchId,
    patientId,
    doctorId: doctorId || patient.doctorId,
    appointmentId: appointmentId || null,
    items: totals.items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxRate: rate,
    tax: totals.tax,
    total: totals.total,
    paidAmount: 0,
    dueAmount: totals.total,
    paymentStatus: totals.total <= 0 ? 'paid' : 'unpaid',
    notes: notes || '',
    createdBy: req.user._id,
    invoiceDate: req.body.invoiceDate || new Date(),
  });

  await writeAudit({
    clinicId: invoice.clinicId,
    branchId: invoice.branchId,
    actorId: req.user._id,
    action: AUDIT.INVOICE_CREATED,
    entityType: 'Invoice',
    entityId: invoice._id,
    detail: invoice.invoiceNumber,
    metadata: { total: invoice.total },
  });
  await recordPatientEvent({
    clinicId: invoice.clinicId,
    doctorId: invoice.doctorId,
    patientId: invoice.patientId,
    type: 'invoice_created',
    title: 'Invoice created',
    detail: `${invoice.invoiceNumber} · ₹${invoice.total}`,
    appointmentId: invoice.appointmentId,
  });

  await invoice.populate(POPULATE);
  res.status(201).json({ success: true, invoice });
});

export const updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  if (invoice.paymentStatus === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Cancelled invoices cannot be edited.' });
  }
  if (invoice.paidAmount > 0 && req.body.items) {
    return res.status(400).json({ success: false, message: 'Cannot change items after payment has been recorded.' });
  }
  const items = req.body.items || invoice.items;
  const discount = req.body.discount != null ? req.body.discount : invoice.discount;
  const taxRate = req.body.taxRate != null ? req.body.taxRate : invoice.taxRate;
  const totals = computeInvoiceTotals({ items, discount, taxRate });
  invoice.items = totals.items;
  invoice.subtotal = totals.subtotal;
  invoice.discount = totals.discount;
  invoice.taxRate = taxRate;
  invoice.tax = totals.tax;
  invoice.total = totals.total;
  if (req.body.notes !== undefined) invoice.notes = req.body.notes;
  if (req.body.doctorId) invoice.doctorId = req.body.doctorId;
  await refreshInvoicePayment(invoice);
  await invoice.populate(POPULATE);
  res.json({ success: true, invoice });
});

export const recordPayment = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  if (invoice.paymentStatus === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Cannot pay a cancelled invoice.' });
  }
  const amount = roundMoney(req.body.amount);
  if (amount <= 0) return res.status(400).json({ success: false, message: 'Amount must be greater than 0.' });
  if (amount > invoice.dueAmount + 0.009) {
    return res.status(400).json({ success: false, message: `Amount exceeds due (₹${invoice.dueAmount}).` });
  }

  const payment = await Payment.create({
    invoiceId: invoice._id,
    clinicId: invoice.clinicId,
    branchId: invoice.branchId,
    amount,
    paymentMethod: req.body.paymentMethod || 'cash',
    transactionReference: req.body.transactionReference || '',
    paymentDate: req.body.paymentDate || new Date(),
    receivedBy: req.user._id,
    status: 'completed',
    receiptNumber: await nextReceiptNumber(invoice.clinicId),
    notes: req.body.notes || '',
  });

  await refreshInvoicePayment(invoice);

  if (invoice.inventoryDeducted !== true && ['paid', 'partially_paid'].includes(invoice.paymentStatus)) {
    try {
      await deductInvoiceStock(invoice, req.user._id);
    } catch (err) {
      await Payment.deleteOne({ _id: payment._id });
      await refreshInvoicePayment(invoice);
      return res.status(err.status || 400).json({ success: false, message: err.message });
    }
  }

  await writeAudit({
    clinicId: invoice.clinicId,
    branchId: invoice.branchId,
    actorId: req.user._id,
    action: AUDIT.PAYMENT_RECEIVED,
    entityType: 'Payment',
    entityId: payment._id,
    detail: `${payment.receiptNumber} · ₹${amount}`,
    metadata: { invoiceId: invoice._id, method: payment.paymentMethod },
  });
  await recordPatientEvent({
    clinicId: invoice.clinicId,
    doctorId: invoice.doctorId,
    patientId: invoice.patientId,
    type: 'payment_received',
    title: 'Payment received',
    detail: `₹${amount} via ${payment.paymentMethod}`,
    appointmentId: invoice.appointmentId,
  });

  await invoice.populate(POPULATE);
  res.status(201).json({ success: true, payment, invoice });
});

export const refundPayment = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  const amount = roundMoney(req.body.amount != null ? req.body.amount : invoice.paidAmount);
  if (amount <= 0 || amount > invoice.paidAmount) {
    return res.status(400).json({ success: false, message: 'Refund amount is invalid.' });
  }

  const refund = await Payment.create({
    invoiceId: invoice._id,
    clinicId: invoice.clinicId,
    branchId: invoice.branchId,
    amount,
    paymentMethod: req.body.paymentMethod || 'cash',
    transactionReference: req.body.transactionReference || '',
    paymentDate: new Date(),
    receivedBy: req.user._id,
    status: 'refunded',
    receiptNumber: await nextReceiptNumber(invoice.clinicId),
    notes: req.body.notes || 'Refund',
    refundOf: req.body.paymentId || null,
  });

  await refreshInvoicePayment(invoice);
  if (invoice.paymentStatus === 'refunded' || req.body.reverseStock) {
    await reverseInvoiceStock(invoice, req.user._id, 'Payment refunded');
  }

  await writeAudit({
    clinicId: invoice.clinicId,
    branchId: invoice.branchId,
    actorId: req.user._id,
    action: AUDIT.PAYMENT_REFUNDED,
    entityType: 'Payment',
    entityId: refund._id,
    detail: `Refund ₹${amount} on ${invoice.invoiceNumber}`,
  });

  await invoice.populate(POPULATE);
  res.json({ success: true, payment: refund, invoice });
});

export const cancelInvoice = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  if (invoice.paidAmount > 0) {
    return res.status(400).json({ success: false, message: 'Refund payments before cancelling a paid invoice.' });
  }
  invoice.paymentStatus = 'cancelled';
  invoice.cancelledAt = new Date();
  invoice.dueAmount = 0;
  await reverseInvoiceStock(invoice, req.user._id, 'Invoice cancelled');
  await invoice.save();
  res.json({ success: true, invoice });
});

export const revenueSummary = asyncHandler(async (req, res) => {
  if (!hasPermission(req.user, P.REVENUE_ALL) && !hasPermission(req.user, P.REVENUE_OWN)) {
    return res.status(403).json({ success: false, message: 'Not authorized to view revenue.' });
  }

  const match = tenantFilter(req.user, req.branchId);
  if (req.user.role === 'doctor' && !hasPermission(req.user, P.REVENUE_ALL)) {
    match.doctorId = req.user._id;
  }
  if (req.query.from || req.query.to) {
    match.paymentDate = {};
    if (req.query.from) match.paymentDate.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      match.paymentDate.$lte = to;
    }
  }

  const completedMatch = { ...match, status: 'completed' };
  const [byMethod, totals, outstanding, byDoctor, byBranch] = await Promise.all([
    Payment.aggregate([
      { $match: completedMatch },
      { $group: { _id: '$paymentMethod', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: completedMatch },
      { $group: { _id: null, collected: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: { ...tenantFilter(req.user, req.branchId), paymentStatus: { $in: ['unpaid', 'partially_paid'] } } },
      { $group: { _id: null, due: { $sum: '$dueAmount' }, count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: { ...tenantFilter(req.user, req.branchId), paymentStatus: { $ne: 'cancelled' } } },
      { $group: { _id: '$doctorId', billed: { $sum: '$total' }, paid: { $sum: '$paidAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...tenantFilter(req.user, req.branchId), paymentStatus: { $ne: 'cancelled' } } },
      { $group: { _id: '$branchId', billed: { $sum: '$total' }, paid: { $sum: '$paidAmount' } } },
    ]),
  ]);

  const doctorIds = byDoctor.map((d) => d._id).filter(Boolean);
  const doctors = await User.find({ _id: { $in: doctorIds } }).select('name');
  const doctorMap = Object.fromEntries(doctors.map((d) => [String(d._id), d.name]));
  const branchIds = byBranch.map((b) => b._id).filter(Boolean);
  const branches = await Branch.find({ _id: { $in: branchIds } }).select('name');
  const branchMap = Object.fromEntries(branches.map((b) => [String(b._id), b.name]));

  res.json({
    success: true,
    summary: {
      collected: roundMoney(totals[0]?.collected || 0),
      paymentCount: totals[0]?.count || 0,
      outstanding: roundMoney(outstanding[0]?.due || 0),
      outstandingCount: outstanding[0]?.count || 0,
      byMethod,
      byDoctor: byDoctor.map((d) => ({ ...d, doctorName: doctorMap[String(d._id)] || 'Unassigned' })),
      byBranch: byBranch.map((b) => ({
        ...b,
        billed: roundMoney(b.billed),
        paid: roundMoney(b.paid),
        branchName: branchMap[String(b._id)] || 'Unassigned',
      })),
    },
  });
});

export const patientBilling = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.patientId);
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });
  assertSameClinic(req.user, patient.clinicId);
  assertBranchAccess(req.user, patient.branchId);
  const filter = { clinicId: patient.clinicId, patientId: patient._id };
  if (req.user.role === 'doctor' && !hasPermission(req.user, P.REVENUE_ALL)) {
    filter.doctorId = req.user._id;
  }
  const invoices = await Invoice.find(filter).sort({ invoiceDate: -1 }).limit(100).populate('doctorId', 'name');
  res.json({ success: true, invoices });
});
