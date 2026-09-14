import mongoose from 'mongoose';

const inventoryLotSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true, index: true },
    batchNumber: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 0, min: 0 },
    purchasePrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    expiryDate: { type: Date, default: null, index: true },
    supplier: { type: String, default: '', trim: true },
    receivedAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

inventoryLotSchema.index({ clinicId: 1, branchId: 1, medicineId: 1 });
inventoryLotSchema.index({ clinicId: 1, branchId: 1, batchNumber: 1, medicineId: 1 });

const InventoryLot = mongoose.model('InventoryLot', inventoryLotSchema);
export default InventoryLot;
