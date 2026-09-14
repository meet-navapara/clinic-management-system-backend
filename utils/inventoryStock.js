import InventoryLot from '../models/InventoryLot.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import Medicine from '../models/Medicine.js';

const alreadyRecorded = async (referenceType, referenceId, type) => {
  if (!referenceId) return false;
  return InventoryTransaction.exists({ referenceType, referenceId, type });
};

export async function applyStockChange({
  clinicId,
  branchId,
  medicineId,
  lotId = null,
  type,
  quantity,
  unitCost = 0,
  referenceType = '',
  referenceId = null,
  reason = '',
  performedBy = null,
}) {
  const qty = Number(quantity);
  if (!qty) return null;

  if (referenceId && (await alreadyRecorded(referenceType, referenceId, type))) {
    return { skipped: true, reason: 'duplicate' };
  }

  let lot = null;
  if (lotId) {
    lot = await InventoryLot.findOne({ _id: lotId, clinicId, branchId, medicineId });
  } else if (['sale', 'stock_out'].includes(type) && qty > 0) {
    lot = await InventoryLot.findOne({
      clinicId,
      branchId,
      medicineId,
      isActive: true,
      quantity: { $gt: 0 },
    }).sort({ expiryDate: 1, createdAt: 1 });
  }

  const delta = ['stock_in', 'return', 'refund_reversal'].includes(type) ? Math.abs(qty) : -Math.abs(qty);

  if (lot) {
    const next = (lot.quantity || 0) + delta;
    if (next < 0) {
      const err = new Error(`Insufficient stock for this medicine (available: ${lot.quantity}).`);
      err.status = 400;
      throw err;
    }
    lot.quantity = next;
    await lot.save();
  } else if (type === 'stock_in') {
    const medicine = await Medicine.findById(medicineId);
    lot = await InventoryLot.create({
      clinicId,
      branchId,
      medicineId,
      batchNumber: `IN-${Date.now()}`,
      quantity: Math.abs(qty),
      purchasePrice: unitCost,
      sellingPrice: medicine?.sellingPrice || 0,
    });
  } else if (delta < 0) {
    const err = new Error('No stock lot available for this medicine at this branch.');
    err.status = 400;
    throw err;
  }

  const tx = await InventoryTransaction.create({
    clinicId,
    branchId,
    medicineId,
    lotId: lot?._id || null,
    type,
    quantity: delta,
    balanceAfter: lot?.quantity ?? 0,
    unitCost,
    referenceType,
    referenceId,
    reason,
    performedBy,
  });

  return { lot, transaction: tx };
}

export async function deductInvoiceStock(invoice, userId) {
  if (!invoice || invoice.inventoryDeducted) return;
  const medicineLines = (invoice.items || []).filter((i) => i.type === 'medicine' && i.medicineId && i.quantity > 0);
  for (const line of medicineLines) {
    await applyStockChange({
      clinicId: invoice.clinicId,
      branchId: invoice.branchId,
      medicineId: line.medicineId,
      lotId: line.lotId || null,
      type: 'sale',
      quantity: line.quantity,
      unitCost: line.unitPrice,
      referenceType: 'invoice',
      referenceId: invoice._id,
      reason: `Invoice ${invoice.invoiceNumber}`,
      performedBy: userId,
    });
  }
  invoice.inventoryDeducted = true;
  await invoice.save();
}

export async function reverseInvoiceStock(invoice, userId, reason = 'Invoice cancelled/refunded') {
  if (!invoice?.inventoryDeducted) return;
  const medicineLines = (invoice.items || []).filter((i) => i.type === 'medicine' && i.medicineId && i.quantity > 0);
  for (const line of medicineLines) {
    await applyStockChange({
      clinicId: invoice.clinicId,
      branchId: invoice.branchId,
      medicineId: line.medicineId,
      lotId: line.lotId || null,
      type: 'refund_reversal',
      quantity: line.quantity,
      unitCost: line.unitPrice,
      referenceType: 'invoice_reversal',
      referenceId: invoice._id,
      reason,
      performedBy: userId,
    });
  }
}

export async function medicineStockByBranch(clinicId, branchId, medicineIds, extraMatch = {}) {
  const match = { clinicId, isActive: true, ...extraMatch };
  if (branchId) match.branchId = branchId;
  if (medicineIds?.length) match.medicineId = { $in: medicineIds };
  return InventoryLot.aggregate([
    { $match: match },
    { $group: { _id: '$medicineId', quantity: { $sum: '$quantity' } } },
  ]);
}
