import InventoryLot from '../models/InventoryLot.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import Medicine from '../models/Medicine.js';
import Clinic from '../models/Clinic.js';
import { asyncHandler } from '../middleware/access.js';
import { tenantFilter, assertSameClinic, assertBranchAccess } from '../utils/branchScope.js';
import { parsePagination, paginated } from '../utils/pagination.js';
import { applyStockChange } from '../utils/inventoryStock.js';
import { writeAudit, AUDIT } from '../utils/audit.js';

export const listLots = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = tenantFilter(req.user, req.branchId);
  if (req.query.medicineId) filter.medicineId = req.query.medicineId;
  if (req.query.expiring === 'true') {
    const clinic = await Clinic.findById(req.user.clinicId);
    const days = Number(req.query.days) || clinic?.expiryWarningDays || 60;
    const until = new Date();
    until.setDate(until.getDate() + days);
    filter.expiryDate = { $ne: null, $lte: until, $gte: new Date() };
    filter.quantity = { $gt: 0 };
  }
  if (req.query.lowStock === 'true') {
    /* handled after join */
  }
  const [rows, total] = await Promise.all([
    InventoryLot.find(filter).sort({ expiryDate: 1 }).skip(skip).limit(limit).populate('medicineId', 'name genericName strength dosageForm minimumStockLevel sellingPrice unit'),
    InventoryLot.countDocuments(filter),
  ]);
  res.json({ success: true, ...paginated({ items: rows, total, page, limit }), lots: rows });
});

export const stockSummary = asyncHandler(async (req, res) => {
  const clinic = await Clinic.findById(req.user.clinicId);
  const days = Number(req.query.days) || clinic?.expiryWarningDays || 60;
  const until = new Date();
  until.setDate(until.getDate() + days);
  const base = tenantFilter(req.user, req.branchId);

  const [low, expiring, totals] = await Promise.all([
    InventoryLot.aggregate([
      { $match: { ...base, isActive: true } },
      { $group: { _id: '$medicineId', quantity: { $sum: '$quantity' } } },
      {
        $lookup: {
          from: 'medicines',
          localField: '_id',
          foreignField: '_id',
          as: 'medicine',
        },
      },
      { $unwind: '$medicine' },
      { $match: { $expr: { $lt: ['$quantity', '$medicine.minimumStockLevel'] } } },
      { $limit: 50 },
    ]),
    InventoryLot.find({
      ...base,
      expiryDate: { $ne: null, $lte: until, $gte: new Date() },
      quantity: { $gt: 0 },
    })
      .populate('medicineId', 'name strength dosageForm')
      .limit(50),
    InventoryLot.aggregate([
      { $match: { ...base, isActive: true } },
      { $group: { _id: null, sku: { $addToSet: '$medicineId' }, units: { $sum: '$quantity' } } },
    ]),
  ]);

  res.json({
    success: true,
    summary: {
      skuCount: totals[0]?.sku?.length || 0,
      units: totals[0]?.units || 0,
      lowStock: low.map((r) => ({
        medicineId: r._id,
        name: r.medicine.name,
        remaining: r.quantity,
        minimum: r.medicine.minimumStockLevel,
      })),
      expiring,
      warningDays: days,
    },
  });
});

export const stockIn = asyncHandler(async (req, res) => {
  const { medicineId, batchNumber, quantity, purchasePrice, sellingPrice, expiryDate, supplier } = req.body;
  if (!medicineId || !batchNumber || !quantity) {
    return res.status(400).json({ success: false, message: 'medicineId, batchNumber and quantity are required.' });
  }
  if (!req.branchId) {
    return res.status(400).json({ success: false, message: 'Select a branch before adding stock.' });
  }
  const medicine = await Medicine.findById(medicineId);
  if (!medicine) return res.status(404).json({ success: false, message: 'Medicine not found.' });
  assertSameClinic(req.user, medicine.clinicId);

  let lot = await InventoryLot.findOne({
    clinicId: req.user.clinicId,
    branchId: req.branchId,
    medicineId,
    batchNumber: String(batchNumber).trim(),
  });
  if (!lot) {
    lot = await InventoryLot.create({
      clinicId: req.user.clinicId,
      branchId: req.branchId,
      medicineId,
      batchNumber: String(batchNumber).trim(),
      quantity: 0,
      purchasePrice: purchasePrice ?? medicine.purchasePrice,
      sellingPrice: sellingPrice ?? medicine.sellingPrice,
      expiryDate: expiryDate || null,
      supplier: supplier || '',
    });
  } else {
    if (purchasePrice != null) lot.purchasePrice = purchasePrice;
    if (sellingPrice != null) lot.sellingPrice = sellingPrice;
    if (expiryDate) lot.expiryDate = expiryDate;
    if (supplier) lot.supplier = supplier;
    await lot.save();
  }

  const result = await applyStockChange({
    clinicId: req.user.clinicId,
    branchId: req.branchId,
    medicineId,
    lotId: lot._id,
    type: 'stock_in',
    quantity,
    unitCost: purchasePrice ?? medicine.purchasePrice,
    referenceType: 'stock_in',
    reason: req.body.reason || 'Stock in',
    performedBy: req.user._id,
  });

  res.status(201).json({ success: true, lot: result.lot, transaction: result.transaction });
});

export const adjustStock = asyncHandler(async (req, res) => {
  const { lotId, quantity, reason, type } = req.body;
  const lot = await InventoryLot.findById(lotId);
  if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });
  assertSameClinic(req.user, lot.clinicId);
  assertBranchAccess(req.user, lot.branchId);
  const txType = type === 'stock_out' ? 'stock_out' : 'adjustment';
  const result = await applyStockChange({
    clinicId: lot.clinicId,
    branchId: lot.branchId,
    medicineId: lot.medicineId,
    lotId: lot._id,
    type: txType,
    quantity,
    referenceType: 'adjustment',
    reason: reason || 'Manual adjustment',
    performedBy: req.user._id,
  });
  await writeAudit({
    clinicId: lot.clinicId,
    branchId: lot.branchId,
    actorId: req.user._id,
    action: AUDIT.STOCK_ADJUSTED,
    entityType: 'InventoryLot',
    entityId: lot._id,
    detail: `${txType} ${quantity}`,
  });
  res.json({ success: true, lot: result.lot, transaction: result.transaction });
});

export const listTransactions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = tenantFilter(req.user, req.branchId);
  if (req.query.medicineId) filter.medicineId = req.query.medicineId;
  if (req.query.type) filter.type = req.query.type;
  const [rows, total] = await Promise.all([
    InventoryTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('medicineId', 'name strength')
      .populate('performedBy', 'name'),
    InventoryTransaction.countDocuments(filter),
  ]);
  res.json({ success: true, ...paginated({ items: rows, total, page, limit }), transactions: rows });
});
