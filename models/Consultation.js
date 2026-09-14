import mongoose from 'mongoose';

const vitalsSchema = new mongoose.Schema(
  {
    bp: { type: String, default: '' },
    pulse: { type: String, default: '' },
    temperature: { type: String, default: '' },
    weight: { type: String, default: '' },
    height: { type: String, default: '' },
    spo2: { type: String, default: '' },
  },
  { _id: false }
);

const consultationSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null, index: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalTemplate', default: null },
    chiefComplaint: { type: String, default: '', trim: true },
    symptoms: { type: String, default: '', trim: true },
    observation: { type: String, default: '', trim: true },
    diagnosis: { type: String, default: '', trim: true },
    treatment: { type: String, default: '', trim: true },
    advice: { type: String, default: '', trim: true },
    followUp: { type: String, default: '', trim: true },
    vitals: { type: vitalsSchema, default: () => ({}) },
    status: { type: String, enum: ['draft', 'completed'], default: 'draft', index: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

consultationSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });

const Consultation = mongoose.model('Consultation', consultationSchema);
export default Consultation;
