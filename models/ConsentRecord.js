import mongoose from 'mongoose';

const consentRecordSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    consentTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsentTemplate', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    version: { type: Number, required: true },
    titleSnapshot: { type: String, default: '' },
    bodySnapshot: { type: String, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending', index: true },
    signedAt: { type: Date, default: null },
    signatureDataUrl: { type: String, default: '' },
    signerName: { type: String, default: '', trim: true },
    capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true }
);

consentRecordSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });

const ConsentRecord = mongoose.model('ConsentRecord', consentRecordSchema);
export default ConsentRecord;
