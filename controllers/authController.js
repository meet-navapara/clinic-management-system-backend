import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Clinic from '../models/Clinic.js';
import generateToken from '../utils/generateToken.js';
import { toAuthUser } from '../utils/authUser.js';
import {
  DEFAULT_CLINIC_NAME,
  DEFAULT_CLINIC_SLUG,
  migrateClinicTenancy,
} from '../utils/migrateClinic.js';

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

const assertSetupKey = (setupKey, res) => {
  const setupSecret = process.env.ADMIN_SETUP_SECRET;
  if (!setupSecret) {
    res.status(503).json({
      success: false,
      message: 'Admin setup is not configured on the server.',
    });
    return false;
  }
  if (setupKey !== setupSecret) {
    res.status(403).json({ success: false, message: 'Invalid admin setup key.' });
    return false;
  }
  return true;
};

const resolveClinic = async (clinicId) => {
  if (clinicId) {
    const clinic = await Clinic.findOne({ _id: clinicId, isActive: true });
    if (!clinic) return null;
    return clinic;
  }
  return (
    (await Clinic.findOne({ slug: DEFAULT_CLINIC_SLUG, isActive: true })) ||
    (await migrateClinicTenancy()) ||
    (await Clinic.findOne({ isActive: true }).sort({ createdAt: 1 }))
  );
};

export const getSetupStatus = async (req, res) => {
  try {
    const [clinic, clinicAdminExists, doctorExists] = await Promise.all([
      Clinic.findOne({ slug: DEFAULT_CLINIC_SLUG }).select('_id name slug'),
      User.exists({ role: 'clinic_admin' }),
      User.exists({ role: 'doctor' }),
    ]);

    res.json({
      success: true,
      clinicExists: Boolean(clinic),
      clinicAdminExists: Boolean(clinicAdminExists),
      doctorExists: Boolean(doctorExists),
      // Backward-compatible alias used by older frontend
      setupComplete: Boolean(clinicAdminExists),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const register = async (req, res) => {
  return res.status(410).json({
    success: false,
    message:
      'Patient self-registration is disabled. Please contact the clinic; your doctor will add you as a patient.',
  });
};

/** One-time clinic admin bootstrap (separate from doctor accounts). */
export const registerClinicAdmin = async (req, res) => {
  try {
    if (!assertSetupKey(req.body.setupKey, res)) return;

    const existingAdmin = await User.findOne({ role: 'clinic_admin' });
    if (existingAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Clinic admin already exists. Please sign in instead.',
      });
    }

    const { name, email, password, phone } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    let clinic =
      (await Clinic.findOne({ slug: DEFAULT_CLINIC_SLUG })) || (await migrateClinicTenancy());

    if (!clinic) {
      clinic = await Clinic.create({
        name: DEFAULT_CLINIC_NAME,
        slug: DEFAULT_CLINIC_SLUG,
        isActive: true,
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: 'clinic_admin',
      clinicId: clinic._id,
      isActive: true,
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Clinic admin account created successfully.',
      token,
      user: toAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Doctor self-registration (multi-doctor). Existing doctors remain role=doctor.
 * Optional setupKey is accepted for backward compatibility but is not required.
 */
export const registerDoctor = async (req, res) => {
  try {
    const {
      name,
      firstName,
      lastName,
      email,
      password,
      phone,
      specialization,
      qualification,
      experience,
      licenseNumber,
      consultationFee,
      consultationTypes,
      bio,
      clinicName,
      clinicAddress,
      city,
      state,
      country,
      postalCode,
      clinicId,
      setupKey,
    } = req.body;

    if (setupKey) {
      if (!assertSetupKey(setupKey, res)) return;
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const clinic = await resolveClinic(clinicId);
    if (!clinic) {
      return res.status(400).json({ success: false, message: 'No active clinic available for registration.' });
    }

    const displayName =
      name?.trim() ||
      [firstName, lastName].filter(Boolean).join(' ').trim() ||
      '';

    if (!displayName) {
      return res.status(400).json({ success: false, message: 'Name is required.' });
    }

    const user = await User.create({
      name: displayName,
      firstName: firstName || '',
      lastName: lastName || '',
      email,
      password,
      phone,
      role: 'doctor',
      clinicId: clinic._id,
      specialization: specialization || 'Ayurvedic Physician',
      qualification: qualification || '',
      experience: experience || 0,
      licenseNumber: licenseNumber || '',
      consultationFee: consultationFee || 500,
      consultationTypes: Array.isArray(consultationTypes) ? consultationTypes : [],
      bio: bio || '',
      clinicName: clinicName || clinic.name || '',
      clinicAddress: clinicAddress || '',
      city: city || '',
      state: state || '',
      country: country || '',
      postalCode: postalCode || '',
      isActive: true,
      approvalStatus: 'pending',
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Doctor account created. Please wait for admin approval before accessing the dashboard.',
      token,
      user: toAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const registerReceptionist = async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Receptionist registration is disabled in this product.',
  });
};

export const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.role === 'patient' || user.role === 'receptionist') {
      return res.status(403).json({
        success: false,
        message:
          'Patient and staff self-service login is disabled. Doctors manage patient records directly.',
      });
    }

    if (role && user.role !== role) {
      // Allow clinic_admin to login via admin form when role=clinic_admin
      if (!(role === 'clinic_admin' && user.role === 'super_admin')) {
        return res.status(401).json({
          success: false,
          message: `This account is registered as a ${user.role}, not a ${role}.`,
        });
      }
    }

    if (user.role === 'doctor' && user.approvalStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your doctor account is suspended. Contact the clinic admin.',
      });
    }

    if (user.isActive === false && user.approvalStatus !== 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Contact your clinic admin.',
      });
    }

    if (user.role === 'doctor' && user.approvalStatus === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Your doctor account was not approved. Contact the clinic admin.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    user.lastActiveAt = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: toAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMe = async (req, res) => {
  res.json({ success: true, user: toAuthUser(req.user) });
};

export const updateProfile = async (req, res) => {
  try {
    const allowedFields = [
      'name',
      'firstName',
      'lastName',
      'phone',
      'specialization',
      'qualification',
      'experience',
      'licenseNumber',
      'consultationFee',
      'consultationTypes',
      'bio',
      'clinicName',
      'clinicAddress',
      'city',
      'state',
      'country',
      'postalCode',
      'availableDays',
      'availableSlots',
      'practiceSettings',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] === undefined || req.body[field] === '') continue;

      let value = req.body[field];

      if (field === 'availableDays' || field === 'availableSlots' || field === 'consultationTypes') {
        if (Array.isArray(value)) {
          updates[field] = value;
          continue;
        }
        try {
          value = JSON.parse(value);
        } catch {
          continue;
        }
      } else if (field === 'practiceSettings') {
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch {
            continue;
          }
        }
        updates[field] = value;
        continue;
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

    res.json({ success: true, message: 'Profile updated.', user: toAuthUser(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
