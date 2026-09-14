import mongoose from 'mongoose';

export const STOCK_TYPES = ['stock_in', 'stock_out', 'adjustment', 'sale', 'return', 'refund_reversal'];

const inventoryTransactionSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true, index: true },
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot', default: null },
    type: { type: String, enum: STOCK_TYPES, required: true, index: true },
    quantity: { type: Number, required: true },
    balanceAfter: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    referenceType: { type: String, default: '', trim: true },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reason: { type: String, default: '', trim: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

inventoryTransactionSchema.index({ clinicId: 1, branchId: 1, createdAt: -1 });
inventoryTransactionSchema.index({ clinicId: 1, medicineId: 1, createdAt: -1 });
inventoryTransactionSchema.index({ referenceType: 1, referenceId: 1 });

const InventoryTransaction = mongoose.model('InventoryTransaction', inventoryTransactionSchema);
export default InventoryTransaction;
