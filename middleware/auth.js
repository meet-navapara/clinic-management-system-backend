import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { readAuthToken } from '../utils/authCookie.js';

export const protect = async (req, res, next) => {
  try {
    const token = readAuthToken(req);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized. Please login.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    if (user.isActive === false) {
      const isStatusCheck = req.method === 'GET' && req.path === '/me';
      if (!isStatusCheck) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated. Contact Super Admin.',
        });
      }
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized for this action.`,
      });
    }
    next();
  };
};

/** Block unapproved / suspended doctors from clinical APIs. */
export const requireApprovedDoctor = (req, res, next) => {
  if (req.user.role !== 'doctor') return next();
  if (req.user.approvalStatus === 'approved' && req.user.isActive !== false) {
    return next();
  }
  const status = req.user.approvalStatus || 'pending';
  const message =
    status === 'suspended'
      ? 'Your doctor account is suspended.'
      : status === 'rejected'
        ? 'Your doctor account was not approved.'
        : 'Your doctor account is awaiting admin approval.';
  return res.status(403).json({
    success: false,
    message,
    approvalStatus: status,
  });
};

/** Require the authenticated user to belong to a clinic. */
export const requireClinic = (req, res, next) => {
  if (!req.user?.clinicId) {
    return res.status(403).json({
      success: false,
      message: 'No clinic is associated with this account.',
    });
  }
  next();
};

/** True if resource belongs to the user's clinic. Super Admin has no clinic bypass. */
export const isSameClinic = (user, resourceClinicId) => {
  if (!user) return false;
  const resourceId =
    resourceClinicId && typeof resourceClinicId === 'object'
      ? resourceClinicId._id || resourceClinicId.id
      : resourceClinicId;
  if (!resourceId || !user.clinicId) return false;
  return String(resourceId) === String(user.clinicId);
};

/** Mongo filter for clinic-scoped queries. */
export const clinicScopeFilter = (user) => {
  if (!user) return {};
  if (!user.clinicId) return { clinicId: null };
  return { clinicId: user.clinicId };
};
