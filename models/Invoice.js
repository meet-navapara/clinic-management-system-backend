import mongoose from 'mongoose';

export const INVOICE_ITEM_TYPES = [
  'consultation',
  'treatment',
  'medicine',
  'lab_test',
  'procedure',
  'other',
];

export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'refunded', 'cancelled'];

const invoiceItemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: INVOICE_ITEM_TYPES, default: 'other' },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 },
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', default: null },
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot', default: null },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true, index: true },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null, index: true },
    consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', default: null },
    items: { type: [invoiceItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid', index: true },
    invoiceDate: { type: Date, default: Date.now, index: true },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    inventoryDeducted: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

invoiceSchema.index({ clinicId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
invoiceSchema.index({ clinicId: 1, paymentStatus: 1, invoiceDate: -1 });

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
