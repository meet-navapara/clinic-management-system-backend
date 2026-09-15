import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Clinic from '../models/Clinic.js';
import generateToken from '../utils/generateToken.js';
import { setAuthCookie, clearAuthCookie } from '../utils/authCookie.js';
import { toAuthUser } from '../utils/authUser.js';
import { isStaffAccount } from '../utils/permissions.js';
import { assertStaffBranchOperational } from '../utils/branchScope.js';
import {
  DEFAULT_CLINIC_NAME,
  DEFAULT_CLINIC_SLUG,
  migrateClinicTenancy,
} from '../utils/migrateClinic.js';
import { provisionClinicForDoctor } from '../utils/clinicProvisioning.js';
import Branch from '../models/Branch.js';
import { writeAudit, AUDIT } from '../utils/audit.js';
import { normalizeEmail, phoneMatchVariants } from '../utils/normalizeContact.js';

const EMAIL_TAKEN = 'Email already registered.';
const PHONE_TAKEN = 'Mobile number already registered.';

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return User.findOne({ email: normalized });
}

async function findUserByPhone(phone) {
  const variants = phoneMatchVariants(phone);
  if (variants.length) {
    return User.findOne({ phone: { $in: variants } });
  }
  const trimmed = String(phone || '').trim();
  if (!trimmed) return null;
  return User.findOne({ phone: trimmed });
}

async function uniqueContactErrors(email, phone) {
  const [emailOwner, phoneOwner] = await Promise.all([
    findUserByEmail(email),
    findUserByPhone(phone),
  ]);
  const errors = {};
  if (emailOwner) errors.email = EMAIL_TAKEN;
  if (phoneOwner) errors.phone = PHONE_TAKEN;
  return errors;
}

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
    const [clinic, superAdminExists, doctorExists] = await Promise.all([
      Clinic.findOne({ slug: DEFAULT_CLINIC_SLUG }).select('_id name slug'),
      User.exists({ role: 'super_admin' }),
      User.exists({ role: 'doctor' }),
    ]);

    res.json({
      success: true,
      clinicExists: Boolean(clinic),
      superAdminExists: Boolean(superAdminExists),
      clinicAdminExists: Boolean(superAdminExists),
      doctorExists: Boolean(doctorExists),
      setupComplete: Boolean(superAdminExists),
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

/** One-time platform Super Admin bootstrap. Super Admin is not a clinic operator. */
export const registerClinicAdmin = async (req, res) => {
  try {
    if (!assertSetupKey(req.body.setupKey, res)) return;

    const existingAdmin = await User.findOne({ role: 'super_admin' });
    if (existingAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Super Admin already exists. Please sign in instead.',
      });
    }

    const { name, email, password, phone } = req.body;

    const contactErrors = await uniqueContactErrors(email, phone);
    if (Object.keys(contactErrors).length) {
      return res.status(409).json({
        success: false,
        message: contactErrors.email || contactErrors.phone,
        errors: contactErrors,
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: 'super_admin',
      clinicId: null,
      isActive: true,
      approvalStatus: 'approved',
    });

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    res.status(201).json({
      success: true,
      message: 'Super Admin account created successfully.',
      token,
      user: toAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Doctor self-registration.
 * Creating a new clinic or joining an existing one requires ADMIN_SETUP_SECRET.
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

    if (!assertSetupKey(setupKey, res)) return;

    const contactErrors = await uniqueContactErrors(email, phone);
    if (Object.keys(contactErrors).length) {
      return res.status(409).json({
        success: false,
        message: contactErrors.email || contactErrors.phone,
        errors: contactErrors,
      });
    }

    const practiceName = String(clinicName || '').trim();
    if (!practiceName && !clinicId) {
      return res.status(400).json({
        success: false,
        message: 'Practice / clinic name is required.',
      });
    }

    let clinic;
    let branch;

    if (clinicId) {
      // Explicit invite/join only — never fall back to the shared demo clinic.
      clinic = await Clinic.findOne({ _id: clinicId, isActive: true });
      if (!clinic) {
        return res.status(400).json({ success: false, message: 'Clinic not found or inactive.' });
      }
      branch =
        (await Branch.findOne({ clinicId: clinic._id, isDefault: true, isActive: true })) ||
        (await Branch.findOne({ clinicId: clinic._id, isActive: true }).sort({ createdAt: 1 }));
      if (!branch) {
        return res.status(400).json({ success: false, message: 'Clinic has no active branch.' });
      }
    } else {
      const provisioned = await provisionClinicForDoctor({
        clinicName: practiceName,
        clinicAddress,
        city,
        phone,
        email,
      });
      clinic = provisioned.clinic;
      branch = provisioned.branch;
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
      branchIds: [branch._id],
      defaultBranchId: branch._id,
      specialization: specialization || 'Ayurvedic Physician',
      qualification: qualification || '',
      experience: experience || 0,
      licenseNumber: licenseNumber || '',
      consultationFee: consultationFee || 500,
      consultationTypes: Array.isArray(consultationTypes) ? consultationTypes : [],
      bio: bio || '',
      clinicName: clinic.name,
      clinicAddress: clinicAddress || clinic.address || '',
      city: city || '',
      state: state || '',
      country: country || '',
      postalCode: postalCode || '',
      isActive: true,
      approvalStatus: 'pending',
    });

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    res.status(201).json({
      success: true,
      message: 'Doctor account created. Please wait for admin approval before accessing the dashboard.',
      token,
      user: toAuthUser(user),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message = field === 'phone' ? PHONE_TAKEN : EMAIL_TAKEN;
      return res.status(409).json({
        success: false,
        message,
        errors: { [field === 'phone' ? 'phone' : 'email']: message },
      });
    }
    res.status(error.status || 500).json({ success: false, message: error.message });
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
    const normalizedEmail = normalizeEmail(email);

    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.role === 'patient') {
      return res.status(403).json({
        success: false,
        message: 'Patient self-service login is disabled. The clinic manages patient records directly.',
      });
    }

    const isStaffRecord = user.role !== 'super_admin' && user.role !== 'doctor';
    if (isStaffRecord) {
      if (user.loginEnabled !== true) {
        return res.status(403).json({
          success: false,
          message: 'Staff login is disabled. Ask a doctor to enable access for this account.',
        });
      }
      if (role === 'super_admin' || role === 'doctor' || role === 'clinic_admin') {
        return res.status(401).json({
          success: false,
          message: 'This is a clinic staff account. Sign in from clinic sign in without a doctor/admin role.',
        });
      }
    }

    if (user.staffStatus === 'suspended' || user.staffStatus === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active. Contact the clinic.',
      });
    }

    if (role && user.role !== role) {
      const adminAlias = role === 'clinic_admin' && user.role === 'super_admin';
      if (!adminAlias) {
        return res.status(401).json({
          success: false,
          message: `This account is registered as a ${user.role}, not a ${role}.`,
        });
      }
    }

    if (user.role === 'doctor' && user.approvalStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your doctor account is suspended.',
      });
    }

    if (user.isActive === false && user.approvalStatus !== 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Contact Super Admin.',
      });
    }

    if (user.role === 'doctor' && user.approvalStatus === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Your doctor account was not approved. Contact Super Admin.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      if (user.clinicId) {
        await writeAudit({
          clinicId: user.clinicId,
          actorId: user._id,
          action: AUDIT.LOGIN_FAILED,
          entityType: 'user',
          entityId: user._id,
          detail: 'Invalid password',
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (isStaffAccount(user)) {
      try {
        await assertStaffBranchOperational(user);
      } catch (err) {
        return res.status(err.status || 403).json({ success: false, message: err.message });
      }
    }

    user.lastActiveAt = new Date();
    await user.save({ validateBeforeSave: false });

    if (user.clinicId) {
      await writeAudit({
        clinicId: user.clinicId,
        actorId: user._id,
        action: AUDIT.LOGIN_SUCCESS,
        entityType: 'user',
        entityId: user._id,
        detail: `${user.role} login`,
      });
    }

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: toAuthUser(user),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
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

export const logout = async (_req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out.' });
};

export const forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const generic = {
      success: true,
      message: 'If that email is registered, a reset link has been sent.',
    };
    if (!email) return res.json(generic);

    const user = await User.findOne({ email });
    if (!user || user.role === 'patient') return res.json(generic);

    const crypto = await import('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.passwordResetToken = hashed;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const clientOrigin = (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:3000')
      .split(',')[0]
      .trim();
    const resetUrl = `${clientOrigin}/reset-password?token=${rawToken}`;

    try {
      const { sendEmailMessage } = await import('../utils/comms/providers.js');
      await sendEmailMessage({
        toEmail: user.email,
        subject: 'Reset your clinic password',
        text: `Reset your password using this link (valid 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
        html: `<p>Reset your password using this link (valid 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
      });
    } catch (err) {
      // Clear token if email cannot be sent so attackers cannot fish valid tokens offline.
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
        return res.status(503).json({
          success: false,
          message: 'Password reset email is not configured. Contact your administrator.',
        });
      }
      return res.status(502).json({
        success: false,
        message: err.message || 'Failed to send reset email.',
      });
    }

    return res.json(generic);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'A valid reset token and password (min 6 characters) are required.',
      });
    }
    const crypto = await import('crypto');
    const hashed = crypto.createHash('sha256').update(String(token)).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashed,
      passwordResetExpires: { $gt: new Date() },
    }).select('+password');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    const jwtToken = generateToken(user._id);
    setAuthCookie(res, jwtToken);
    res.json({
      success: true,
      message: 'Password updated. You are now signed in.',
      token: jwtToken,
      user: toAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
