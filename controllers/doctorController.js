import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import { SLOT_BLOCKING_STATUSES } from '../models/Appointment.js';
import {
  generateTimeSlots,
  windowFromLegacySlots,
  timeToMinutes,
  filterFutureSlots,
} from '../utils/timeSlots.js';

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
      'availableDays availableSlots name clinicId isActive practiceSettings'
    );

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    if (req.user.role === 'doctor' && String(doctor._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const { date } = req.query;
    const durationMinutes = Math.max(
      5,
      Math.min(
        240,
        Number(req.query.durationMinutes) ||
          doctor.practiceSettings?.defaultDurationMinutes ||
          30
      )
    );

    const workingDays =
      doctor.availableDays?.length > 0
        ? doctor.availableDays
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    // Off days (e.g. Sat/Sun when not in availableDays) offer no bookable slots.
    if (date) {
      const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'long',
      });
      if (!workingDays.includes(dayName)) {
        return res.json({
          success: true,
          doctorId: doctor._id,
          clinicId: doctor.clinicId || null,
          availableDays: doctor.availableDays,
          durationMinutes,
          dayStart: doctor.practiceSettings?.dayStart || '09:00',
          dayEnd: doctor.practiceSettings?.dayEnd || '18:00',
          allSlots: [],
          availableSlots: [],
          bookedSlots: [],
          dayAvailable: false,
        });
      }
    }

    const settings = doctor.practiceSettings || {};
    const legacyWindow = windowFromLegacySlots(doctor.availableSlots);
    const dayStart = settings.dayStart || legacyWindow.dayStart;
    const dayEnd = settings.dayEnd || legacyWindow.dayEnd;
    const breakStart = settings.breakStart || '13:00';
    const breakEnd = settings.breakEnd || '14:00';

    const allSlots = generateTimeSlots({
      dayStart,
      dayEnd,
      durationMinutes,
      breakStart,
      breakEnd,
    });

    let bookedSlots = [];
    let bookedRanges = [];

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const appointments = await Appointment.find({
        doctor: doctor._id,
        appointmentDate: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: [...SLOT_BLOCKING_STATUSES] },
      }).select('timeSlot durationMinutes');

      bookedSlots = appointments.map((a) => a.timeSlot);
      bookedRanges = appointments
        .map((a) => {
          const start = timeToMinutes(a.timeSlot);
          if (start == null) return null;
          const dur = Number(a.durationMinutes) || durationMinutes;
          return { start, end: start + dur };
        })
        .filter(Boolean);
    }

    const openSlots = allSlots.filter((slot) => {
      const start = timeToMinutes(slot);
      if (start == null) return false;
      const end = start + durationMinutes;
      return !bookedRanges.some((b) => start < b.end && end > b.start);
    });

    // Never offer times that have already passed (today / past dates).
    const availableSlots = date ? filterFutureSlots(openSlots, date) : openSlots;

    res.json({
      success: true,
      doctorId: doctor._id,
      clinicId: doctor.clinicId || null,
      availableDays: doctor.availableDays,
      durationMinutes,
      dayStart,
      dayEnd,
      allSlots,
      availableSlots,
      bookedSlots,
      dayAvailable: true,
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
