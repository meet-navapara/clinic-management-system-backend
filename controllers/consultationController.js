import Consultation from '../models/Consultation.js';
import Prescription from '../models/Prescription.js';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';
import Invoice from '../models/Invoice.js';
import QueueTicket from '../models/QueueTicket.js';
import { asyncHandler } from '../middleware/access.js';
import { assertSameClinic, assertBranchAccess } from '../utils/branchScope.js';
import { writeAudit, AUDIT } from '../utils/audit.js';
import { recordPatientEvent } from '../utils/patientTimeline.js';
import { computeInvoiceTotals } from '../utils/money.js';
import { nextSequence } from '../models/Counter.js';
import User from '../models/User.js';

const pad = (n) => String(n).padStart(5, '0');

const loadPatient = async (req, patientId) => {
  const patient = await Patient.findById(patientId);
  if (!patient || !patient.isActive) {
    const err = new Error('Patient not found.');
    err.status = 404;
    throw err;
  }
  assertSameClinic(req.user, patient.clinicId);
  assertBranchAccess(req.user, patient.branchId);
  return patient;
};

export const upsertConsultation = asyncHandler(async (req, res) => {
  const { patientId, appointmentId } = req.body;
  const patient = await loadPatient(req, patientId);
  let consultation = req.body.id ? await Consultation.findById(req.body.id) : null;
  if (!consultation && appointmentId) {
    consultation = await Consultation.findOne({ appointmentId, doctorId: req.user.role === 'doctor' ? req.user._id : { $exists: true } });
  }
  const payload = {
    clinicId: patient.clinicId,
    branchId: patient.branchId || req.branchId,
    doctorId: req.user.role === 'doctor' ? req.user._id : req.body.doctorId || patient.doctorId,
    patientId: patient._id,
    appointmentId: appointmentId || null,
    templateId: req.body.templateId || null,
    chiefComplaint: req.body.chiefComplaint || '',
    symptoms: req.body.symptoms || '',
    observation: req.body.observation || '',
    diagnosis: req.body.diagnosis || '',
    treatment: req.body.treatment || '',
    advice: req.body.advice || '',
    followUp: req.body.followUp || '',
    vitals: req.body.vitals || {},
    status: req.body.status === 'completed' ? 'completed' : 'draft',
  };
  if (payload.status === 'completed') payload.completedAt = new Date();

  if (consultation) {
    assertSameClinic(req.user, consultation.clinicId);
    assertBranchAccess(req.user, consultation.branchId);
    Object.assign(consultation, payload);
    await consultation.save();
  } else {
    consultation = await Consultation.create(payload);
  }

  let prescription = null;
  if (Array.isArray(req.body.medicines)) {
    prescription = await Prescription.findOne({ consultationId: consultation._id });
    const items = req.body.medicines.filter((m) => m?.name);
    if (prescription) {
      prescription.items = items;
      prescription.notes = req.body.prescriptionNotes || '';
      prescription.followUpInstructions = req.body.followUp || '';
      await prescription.save();
    } else if (items.length) {
      prescription = await Prescription.create({
        clinicId: consultation.clinicId,
        branchId: consultation.branchId,
        doctorId: consultation.doctorId,
        patientId: consultation.patientId,
        appointmentId: consultation.appointmentId,
        consultationId: consultation._id,
        items,
        notes: req.body.prescriptionNotes || '',
        followUpInstructions: req.body.followUp || '',
      });
      await writeAudit({
        clinicId: consultation.clinicId,
        branchId: consultation.branchId,
        actorId: req.user._id,
        action: AUDIT.PRESCRIPTION_CREATED,
        entityType: 'Prescription',
        entityId: prescription._id,
        detail: `${items.length} medicine(s)`,
      });
      await recordPatientEvent({
        clinicId: consultation.clinicId,
        doctorId: consultation.doctorId,
        patientId: consultation.patientId,
        type: 'prescription_created',
        title: 'Prescription created',
        detail: `${items.length} medicine(s)`,
        appointmentId: consultation.appointmentId,
      });
    }
  }

  if (consultation.status === 'completed') {
    await writeAudit({
      clinicId: consultation.clinicId,
      branchId: consultation.branchId,
      actorId: req.user._id,
      action: AUDIT.CONSULTATION_COMPLETED,
      entityType: 'Consultation',
      entityId: consultation._id,
    });
    await recordPatientEvent({
      clinicId: consultation.clinicId,
      doctorId: consultation.doctorId,
      patientId: consultation.patientId,
      type: 'consultation_completed',
      title: 'Consultation completed',
      detail: consultation.diagnosis || '',
      appointmentId: consultation.appointmentId,
    });
    if (consultation.appointmentId) {
      const appt = await Appointment.findById(consultation.appointmentId);
      if (appt && !['cancelled', 'no_show', 'completed'].includes(appt.status)) {
        appt.status = 'completed';
        await appt.save();
      }
      await QueueTicket.updateMany(
        {
          appointmentId: consultation.appointmentId,
          status: { $in: ['waiting', 'called', 'in_consultation'] },
        },
        { $set: { status: 'completed', completedAt: new Date() } }
      ).catch(() => {});
    } else {
      await QueueTicket.updateMany(
        {
          patientId: consultation.patientId,
          clinicId: consultation.clinicId,
          status: { $in: ['waiting', 'called', 'in_consultation'] },
          ...(consultation.branchId ? { branchId: consultation.branchId } : {}),
        },
        { $set: { status: 'completed', completedAt: new Date() } }
      ).catch(() => {});
    }
    if (req.body.createInvoice) {
      const existing = consultation.appointmentId
        ? await Invoice.findOne({ appointmentId: consultation.appointmentId, paymentStatus: { $ne: 'cancelled' } })
        : null;
      if (!existing) {
        const doctor = await User.findById(consultation.doctorId).select('consultationFee name');
        const fee = doctor?.consultationFee || 0;
        const totals = computeInvoiceTotals({
          items: [{ type: 'consultation', name: 'Consultation', quantity: 1, unitPrice: fee }],
          discount: 0,
          taxRate: 0,
        });
        const seq = await nextSequence(`invoice:${consultation.clinicId}`);
        await Invoice.create({
          invoiceNumber: `INV-${new Date().getFullYear()}-${pad(seq)}`,
          clinicId: consultation.clinicId,
          branchId: consultation.branchId,
          patientId: consultation.patientId,
          doctorId: consultation.doctorId,
          appointmentId: consultation.appointmentId,
          consultationId: consultation._id,
          items: totals.items,
          subtotal: totals.subtotal,
          discount: 0,
          tax: 0,
          total: totals.total,
          dueAmount: totals.total,
          paymentStatus: totals.total <= 0 ? 'paid' : 'unpaid',
          createdBy: req.user._id,
        });
      }
    }
  }

  res.json({ success: true, consultation, prescription });
});

export const getConsultation = asyncHandler(async (req, res) => {
  const consultation = await Consultation.findById(req.params.id);
  if (!consultation) return res.status(404).json({ success: false, message: 'Consultation not found.' });
  assertSameClinic(req.user, consultation.clinicId);
  assertBranchAccess(req.user, consultation.branchId);
  const prescription = await Prescription.findOne({ consultationId: consultation._id });
  res.json({ success: true, consultation, prescription });
});

export const getByAppointment = asyncHandler(async (req, res) => {
  const consultation = await Consultation.findOne({ appointmentId: req.params.appointmentId });
  if (consultation) {
    assertSameClinic(req.user, consultation.clinicId);
    assertBranchAccess(req.user, consultation.branchId);
  } else {
    const appointment = await Appointment.findById(req.params.appointmentId).select('clinicId branchId');
    if (appointment) {
      assertSameClinic(req.user, appointment.clinicId);
      assertBranchAccess(req.user, appointment.branchId);
    }
  }
  const prescription = consultation ? await Prescription.findOne({ consultationId: consultation._id }) : null;
  res.json({ success: true, consultation, prescription });
});

export const listPatientConsultations = asyncHandler(async (req, res) => {
  const patient = await loadPatient(req, req.params.patientId);
  const consultations = await Consultation.find({ patientId: patient._id, clinicId: patient.clinicId })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('doctorId', 'name');
  const prescriptions = await Prescription.find({ patientId: patient._id, clinicId: patient.clinicId })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json({ success: true, consultations, prescriptions });
});
