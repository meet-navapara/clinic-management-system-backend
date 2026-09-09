import { validationResult } from 'express-validator';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import { buildWhatsAppUrl } from '../utils/whatsapp.js';

export const createAppointment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { doctorId, appointmentDate, timeSlot, reason } = req.body;

    const doctor = await User.findOne({ _id: doctorId, role: 'doctor', isActive: true });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    const date = new Date(appointmentDate);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

    if (!doctor.availableDays.includes(dayName)) {
      return res.status(400).json({
        success: false,
        message: `Doctor is not available on ${dayName}.`,
      });
    }

    if (!doctor.availableSlots.includes(timeSlot)) {
      return res.status(400).json({
        success: false,
        message: 'Selected time slot is not available.',
      });
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await Appointment.findOne({
      doctor: doctorId,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
      timeSlot,
      status: { $ne: 'cancelled' },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'This time slot is already booked. Please choose another.',
      });
    }

    const appointment = await Appointment.create({
      patient: req.user._id,
      doctor: doctorId,
      appointmentDate: date,
      timeSlot,
      reason,
    });

    await appointment.populate([
      { path: 'patient', select: 'name email phone profilePhoto' },
      { path: 'doctor', select: 'name specialization phone consultationFee profilePhoto' },
    ]);

    const whatsappUrl = buildWhatsAppUrl(appointment, appointment.patient, appointment.doctor);

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully!',
      appointment,
      whatsappUrl,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This time slot is already booked.',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyAppointments = async (req, res) => {
  try {
    const filter =
      req.user.role === 'doctor'
        ? { doctor: req.user._id }
        : { patient: req.user._id };

    const appointments = await Appointment.find(filter)
      .populate('patient', 'name email phone profilePhoto')
      .populate('doctor', 'name specialization consultationFee phone profilePhoto')
      .sort({ appointmentDate: -1, timeSlot: 1 });

    res.json({ success: true, count: appointments.length, appointments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAppointmentStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    const isDoctor = req.user.role === 'doctor' && appointment.doctor.toString() === req.user._id.toString();
    const isPatient = req.user.role === 'patient' && appointment.patient.toString() === req.user._id.toString();

    if (!isDoctor && !isPatient) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    if (req.user.role === 'patient' && status !== 'cancelled') {
      return res.status(403).json({
        success: false,
        message: 'Patients can only cancel appointments.',
      });
    }

    appointment.status = status;
    await appointment.save();

    await appointment.populate([
      { path: 'patient', select: 'name email phone profilePhoto' },
      { path: 'doctor', select: 'name specialization phone profilePhoto' },
    ]);

    res.json({ success: true, message: `Appointment ${status}.`, appointment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getWhatsAppLink = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('patient', 'name email phone profilePhoto')
      .populate('doctor', 'name specialization phone profilePhoto');

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    if (!appointment.patient || !appointment.doctor) {
      return res.status(400).json({
        success: false,
        message: 'Cannot generate WhatsApp link — appointment has missing patient or doctor data.',
      });
    }

    const userId = req.user._id.toString();
    const patientId = appointment.patient._id.toString();
    const doctorId = appointment.doctor._id.toString();
    const isOwner = patientId === userId || doctorId === userId;

    if (!isOwner) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const audience = req.user.role === 'doctor' ? 'doctor' : 'clinic';
    const whatsappUrl = buildWhatsAppUrl(
      appointment,
      appointment.patient,
      appointment.doctor,
      audience,
    );

    res.json({ success: true, whatsappUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
