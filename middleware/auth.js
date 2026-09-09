import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized. Please login.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Contact your clinic admin.',
      });
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

/** True if resource belongs to the user's clinic (super_admin bypasses). */
export const isSameClinic = (user, resourceClinicId) => {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (!resourceClinicId || !user.clinicId) return false;
  return String(resourceClinicId) === String(user.clinicId);
};

/** Mongo filter for clinic-scoped queries. */
export const clinicScopeFilter = (user) => {
  if (!user) return {};
  if (user.role === 'super_admin') return {};
  if (!user.clinicId) return { clinicId: null };
  return { clinicId: user.clinicId };
};
