import mongoose from 'mongoose';

const prescriptionItemSchema = new mongoose.Schema(
  {
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', default: null },
    name: { type: String, required: true, trim: true },
    genericName: { type: String, default: '', trim: true },
    dosage: { type: String, default: '', trim: true },
    frequency: { type: String, default: '', trim: true },
    duration: { type: String, default: '', trim: true },
    instructions: { type: String, default: '', trim: true },
    quantity: { type: Number, default: 0 },
  },
  { _id: true }
);

const prescriptionSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', default: null, index: true },
    items: { type: [prescriptionItemSchema], default: [] },
    notes: { type: String, default: '', trim: true },
    followUpInstructions: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

prescriptionSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });

const Prescription = mongoose.model('Prescription', prescriptionSchema);
export default Prescription;
