import { validationResult } from 'express-validator';
import Rating from '../models/Rating.js';
import User from '../models/User.js';
import { attachRatingStatsOne } from '../utils/ratingStats.js';

export const createRating = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { doctorId, score, comment } = req.body;

    const doctor = await User.findOne({ _id: doctorId, role: 'doctor', isActive: true });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    const existingRating = await Rating.findOne({
      patient: req.user._id,
      doctor: doctorId,
    });

    if (existingRating) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this doctor.',
      });
    }

    const rating = await Rating.create({
      patient: req.user._id,
      doctor: doctorId,
      score,
      comment: comment?.trim() || '',
    });

    const doctorWithStats = await attachRatingStatsOne(doctor);

    res.status(201).json({
      success: true,
      message: 'Thank you for your feedback!',
      rating,
      doctor: {
        _id: doctorWithStats._id,
        averageRating: doctorWithStats.averageRating,
        ratingCount: doctorWithStats.ratingCount,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this doctor.',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyRatingForDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;

    const rating = await Rating.findOne({
      patient: req.user._id,
      doctor: doctorId,
    }).select('score comment createdAt');

    res.json({
      success: true,
      hasRated: Boolean(rating),
      rating: rating || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDoctorRatings = async (req, res) => {
  try {
    const ratings = await Rating.find({ doctor: req.params.doctorId })
      .populate('patient', 'name')
      .sort({ createdAt: -1 })
      .select('score comment createdAt patient');

    res.json({ success: true, count: ratings.length, ratings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
