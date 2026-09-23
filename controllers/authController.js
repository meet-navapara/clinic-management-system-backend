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
import { normalizeEmail, phoneMatchVariants, normalizeIndianMobile } from '../utils/normalizeContact.js';
import { uploadImageBuffer, isCloudinaryConfigured } from '../utils/cloudinary.js';

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
 * Account stays pending until Super Admin approval.
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
    } = req.body;

    const contactErrors = await uniqueContactErrors(email, phone);
    if (Object.keys(contactErrors).length) {
      return res.status(409).json({
        success: false,
        message: contactErrors.email || contactErrors.phone,
        errors: contactErrors,
      });
    }

    const { consumeEmailVerification } = await import('./emailOtpController.js');
    try {
      await consumeEmailVerification(email, 'signup');
    } catch (verifyErr) {
      return res.status(verifyErr.status || 403).json({
        success: false,
        message: verifyErr.message || 'Please verify your email before creating an account.',
        errors: { email: verifyErr.message || 'Please verify your email before creating an account.' },
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
      emailVerified: true,
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

const MAX_PHOTO_DATA_URL = 500000;

const BASE_PROFILE_FIELDS = ['name', 'firstName', 'lastName', 'phone'];
const DOCTOR_PROFILE_FIELDS = [
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

const parseJsonField = (value) => {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const passwordComplexityOk = (password) => {
  const value = String(password || '');
  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
};

export const updateProfile = async (req, res) => {
  try {
    const isDoctor = req.user.role === 'doctor';
    const allowedFields = isDoctor
      ? [...BASE_PROFILE_FIELDS, ...DOCTOR_PROFILE_FIELDS]
      : BASE_PROFILE_FIELDS;

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] === undefined) continue;

      let value = req.body[field];

      if (field === 'availableDays' || field === 'availableSlots' || field === 'consultationTypes') {
        const parsed = parseJsonField(value);
        if (!parsed) continue;
        if (field === 'availableDays' && Array.isArray(parsed) && parsed.length < 1) {
          return res.status(422).json({
            success: false,
            message: 'Select at least one available day.',
          });
        }
        updates[field] = parsed;
        continue;
      }

      if (field === 'practiceSettings') {
        const parsed = parseJsonField(value);
        if (!parsed || typeof parsed !== 'object') continue;
        const existing = req.user.practiceSettings?.toObject?.() || req.user.practiceSettings || {};
        updates.practiceSettings = {
          ...existing,
          ...parsed,
          defaultDurationMinutes: Math.max(
            5,
            Math.min(240, Number(parsed.defaultDurationMinutes) || existing.defaultDurationMinutes || 30)
          ),
          reminderHoursBefore: Array.isArray(parsed.reminderHoursBefore)
            ? parsed.reminderHoursBefore
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && n > 0)
            : existing.reminderHoursBefore || [24, 2],
          appointmentTypes: Array.isArray(parsed.appointmentTypes)
            ? parsed.appointmentTypes.filter(Boolean)
            : existing.appointmentTypes || ['Consultation', 'Follow-up', 'Procedure'],
          dayStart: parsed.dayStart || existing.dayStart || '09:00',
          dayEnd: parsed.dayEnd || existing.dayEnd || '18:00',
          breakStart: parsed.breakStart || existing.breakStart || '13:00',
          breakEnd: parsed.breakEnd || existing.breakEnd || '14:00',
          sendConfirmationReminder:
            parsed.sendConfirmationReminder !== undefined
              ? Boolean(parsed.sendConfirmationReminder)
              : existing.sendConfirmationReminder !== false,
        };
        continue;
      }

      if (field === 'phone') {
        const phone = normalizeIndianMobile(value);
        if (!phone) {
          return res.status(422).json({
            success: false,
            message: 'Mobile number must be a valid 10-digit Indian number.',
          });
        }
        const owner = await findUserByPhone(phone);
        if (owner && String(owner._id) !== String(req.user._id)) {
          return res.status(409).json({
            success: false,
            message: PHONE_TAKEN,
            errors: { phone: PHONE_TAKEN },
          });
        }
        updates.phone = phone;
        continue;
      }

      if (field === 'experience' || field === 'consultationFee') {
        value = Number(value);
        if (Number.isNaN(value) || value < 0) value = 0;
      }

      if (field === 'name' && !String(value || '').trim()) {
        return res.status(422).json({ success: false, message: 'Name is required.' });
      }

      updates[field] = typeof value === 'string' ? value.trim() : value;
    }

    if (req.file) {
      removeLegacyProfilePhotoFile(req.user.profilePhoto);
      if (isCloudinaryConfigured()) {
        const result = await uploadImageBuffer(req.file.buffer, {
          folder: `clinic-management/${req.user.clinicId || req.user._id}/profile`,
          publicId: `user-${req.user._id}`,
        });
        updates.profilePhoto = result.secure_url;
      } else {
        const dataUrl = bufferToDataUrl(req.file);
        if (dataUrl.length > MAX_PHOTO_DATA_URL) {
          return res.status(400).json({
            success: false,
            message:
              'Photo is too large for local storage. Add CLOUDINARY_* to the server env or use a smaller image.',
          });
        }
        updates.profilePhoto = dataUrl;
      }
    }

    if (req.body.clearPhoto === '1' || req.body.clearPhoto === true) {
      updates.profilePhoto = '';
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

export const changePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(422).json({
        success: false,
        message: 'Current and new password are required.',
      });
    }
    if (!passwordComplexityOk(newPassword)) {
      return res.status(422).json({
        success: false,
        message:
          'New password must be at least 8 characters and include upper, lower, digit, and special character.',
      });
    }
    if (currentPassword === newPassword) {
      return res.status(422).json({
        success: false,
        message: 'New password must be different from the current password.',
      });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const matches = await user.comparePassword(currentPassword);
    if (!matches) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password updated.' });
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
    if (!email || !email.includes('@')) {
      return res.status(422).json({
        success: false,
        message: 'Valid email is required.',
        errors: { email: 'Valid email is required.' },
      });
    }

    const user = await User.findOne({ email });
    if (!user || user.role === 'patient') {
      return res.status(404).json({
        success: false,
        message: 'No account is registered with this email.',
        errors: { email: 'No account is registered with this email.' },
      });
    }

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
    const subject = 'Reset your Z Health password';
    const text = `Reset your password using this link (valid 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`;
    const html = `
      <p>We received a request to reset your Z Health password.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#2f6fed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reset password</a></p>
      <p>Or copy this link:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in <strong>1 hour</strong>.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    try {
      const { sendEmail } = await import('../utils/sendEmail.js');
      await sendEmail({ toEmail: user.email, subject, text, html });
    } catch (err) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(err.status || 502).json({
        success: false,
        message: err.message || 'Failed to send reset email.',
      });
    }

    return res.json({
      success: true,
      message: 'Password reset link sent to your email.',
    });
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

