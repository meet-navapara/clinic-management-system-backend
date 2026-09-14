import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import { ACTIVE_APPOINTMENT_STATUSES } from '../models/Appointment.js';

const clinicScopedFilter = (req, base = {}) => {
  const filter = { ...base };
  if (req.user.clinicId) {
    filter.clinicId = req.user.clinicId;
  }
  return filter;
};

export const getDoctors = async (req, res) => {
  try {
    const { specialization, search } = req.query;
    const filter = clinicScopedFilter(req, {
      role: 'doctor',
      isActive: true,
      approvalStatus: 'approved',
    });

    if (specialization) {
      filter.specialization = { $regex: specialization, $options: 'i' };
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { specialization: { $regex: search, $options: 'i' } },
      ];
    }

    const doctors = await User.find(filter)
      .select('-password')
      .sort({ name: 1 });

    res.json({ success: true, count: doctors.length, doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDoctorById = async (req, res) => {
  try {
    const filter = clinicScopedFilter(req, {
      _id: req.params.id,
      role: 'doctor',
      isActive: true,
      approvalStatus: 'approved',
    });

    const doctor = await User.findOne(filter).select('-password');

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    // Doctors may only open their own profile via this public-ish staff route
    if (req.user.role === 'doctor' && String(doctor._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    res.json({ success: true, doctor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDoctorAvailability = async (req, res) => {
  try {
    const filter = clinicScopedFilter(req, {
      _id: req.params.id,
      role: 'doctor',
      isActive: true,
      approvalStatus: 'approved',
    });

    const doctor = await User.findOne(filter).select(
      'availableDays availableSlots name clinicId isActive'
    );

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    if (req.user.role === 'doctor' && String(doctor._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const { date } = req.query;
    let bookedSlots = [];

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const appointments = await Appointment.find({
        doctor: doctor._id,
        appointmentDate: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: [...ACTIVE_APPOINTMENT_STATUSES, 'completed'] },
      }).select('timeSlot');

      bookedSlots = appointments.map((a) => a.timeSlot);
    }

    const availableSlots = doctor.availableSlots.filter((slot) => !bookedSlots.includes(slot));

    res.json({
      success: true,
      doctorId: doctor._id,
      clinicId: doctor.clinicId || null,
      availableDays: doctor.availableDays,
      availableSlots,
      bookedSlots,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getSpecializations = async (req, res) => {
  try {
    const match = clinicScopedFilter(req, {
      role: 'doctor',
      isActive: true,
      approvalStatus: 'approved',
      specialization: { $ne: '' },
    });

    const specializations = await User.distinct('specialization', match);

    res.json({ success: true, specializations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
