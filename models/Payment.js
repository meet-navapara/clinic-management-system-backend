import mongoose from 'mongoose';

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'online', 'other'];
export const PAYMENT_RECORD_STATUSES = ['completed', 'refunded', 'failed'];

const paymentSchema = new mongoose.Schema(
  {
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    transactionReference: { type: String, default: '', trim: true },
    paymentDate: { type: Date, default: Date.now, index: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: PAYMENT_RECORD_STATUSES, default: 'completed', index: true },
    receiptNumber: { type: String, default: '', trim: true, index: true },
    notes: { type: String, default: '', trim: true },
    refundOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ clinicId: 1, paymentDate: -1 });
paymentSchema.index({ clinicId: 1, branchId: 1, paymentDate: -1 });
paymentSchema.index({ clinicId: 1, paymentMethod: 1, paymentDate: -1 });

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
