import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bufferToDataUrl = (file) =>
  `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

const removeLegacyProfilePhotoFile = (profilePhoto) => {
  if (!profilePhoto?.startsWith('/uploads/')) return;
  const oldPath = path.join(__dirname, '..', profilePhoto.replace(/^\//, ''));
  if (fs.existsSync(oldPath)) {
    fs.unlinkSync(oldPath);
  }
};

export const getSetupStatus = async (req, res) => {
  try {
    const doctorExists = Boolean(await User.findOne({ role: 'doctor' }));
    res.json({ success: true, doctorExists });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (req.body.role === 'doctor') {
      return res.status(403).json({
        success: false,
        message: 'Doctor accounts must be created via the admin setup page.',
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const userData = { name, email, password, phone, role: 'patient' };

    const user = await User.create(userData);
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Patient registered successfully.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profilePhoto: user.profilePhoto || '',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const registerDoctor = async (req, res) => {
  try {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    if (!setupSecret) {
      return res.status(503).json({
        success: false,
        message: 'Admin setup is not configured on the server.',
      });
    }

    if (req.body.setupKey !== setupSecret) {
      return res.status(403).json({ success: false, message: 'Invalid admin setup key.' });
    }

    const existingDoctor = await User.findOne({ role: 'doctor' });
    if (existingDoctor) {
      return res.status(403).json({
        success: false,
        message: 'Doctor account already exists. Please sign in instead.',
      });
    }

    const {
      name,
      email,
      password,
      phone,
      specialization,
      experience,
      consultationFee,
      bio,
    } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: 'doctor',
      specialization: specialization || 'Ayurvedic Physician',
      experience: experience || 0,
      consultationFee: consultationFee || 500,
      bio: bio || '',
      isActive: true,
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Doctor admin account created successfully.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        specialization: user.specialization,
        experience: user.experience,
        consultationFee: user.consultationFee,
        bio: user.bio,
        availableDays: user.availableDays,
        availableSlots: user.availableSlots,
        profilePhoto: user.profilePhoto || '',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (role && user.role !== role) {
      return res.status(401).json({
        success: false,
        message: `This account is registered as a ${user.role}, not a ${role}.`,
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        specialization: user.specialization,
        experience: user.experience,
        consultationFee: user.consultationFee,
        bio: user.bio,
        availableDays: user.availableDays,
        availableSlots: user.availableSlots,
        profilePhoto: user.profilePhoto || '',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

export const updateProfile = async (req, res) => {
  try {
    const allowedFields = [
      'name',
      'phone',
      'specialization',
      'experience',
      'consultationFee',
      'bio',
      'availableDays',
      'availableSlots',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] === undefined || req.body[field] === '') continue;

      let value = req.body[field];

      if (field === 'availableDays' || field === 'availableSlots') {
        if (Array.isArray(value)) {
          updates[field] = value;
          continue;
        }
        try {
          value = JSON.parse(value);
        } catch {
          continue;
        }
      } else if (field === 'experience' || field === 'consultationFee') {
        value = Number(value);
      }

      updates[field] = value;
    }

    if (req.file) {
      removeLegacyProfilePhotoFile(req.user.profilePhoto);
      updates.profilePhoto = bufferToDataUrl(req.file);
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).select('-password');

    res.json({ success: true, message: 'Profile updated.', user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
