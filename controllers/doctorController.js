import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import { attachRatingStats, attachRatingStatsOne } from '../utils/ratingStats.js';

export const getDoctors = async (req, res) => {
  try {
    const { specialization, search } = req.query;
    const filter = { role: 'doctor', isActive: true };

    if (specialization) {
      filter.specialization = { $regex: specialization, $options: 'i' };
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { specialization: { $regex: search, $options: 'i' } },
      ];
    }

    const doctors = await User.find(filter).select(
      '-password -email -phone -availableDays -availableSlots'
    );

    const doctorsWithRatings = await attachRatingStats(doctors);

    res.json({ success: true, count: doctorsWithRatings.length, doctors: doctorsWithRatings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDoctorById = async (req, res) => {
  try {
    const doctor = await User.findOne({ _id: req.params.id, role: 'doctor', isActive: true }).select(
      '-password'
    );

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    const doctorWithRatings = await attachRatingStatsOne(doctor);

    res.json({ success: true, doctor: doctorWithRatings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDoctorAvailability = async (req, res) => {
  try {
    const doctor = await User.findOne({ _id: req.params.id, role: 'doctor' }).select(
      'availableDays availableSlots name'
    );

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
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
        status: { $ne: 'cancelled' },
      }).select('timeSlot');

      bookedSlots = appointments.map((a) => a.timeSlot);
    }

    const availableSlots = doctor.availableSlots.filter((slot) => !bookedSlots.includes(slot));

    res.json({
      success: true,
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
    const specializations = await User.distinct('specialization', {
      role: 'doctor',
      isActive: true,
      specialization: { $ne: '' },
    });

    res.json({ success: true, specializations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
