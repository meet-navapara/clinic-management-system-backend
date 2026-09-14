import { hasPermission, hasAnyPermission, STAFF_ROLES, isApprovedDoctor, isActiveStaffLogin, isStaffAccount } from '../utils/permissions.js';
import {
  resolveRequestedBranchId,
  getAccessibleBranchIds,
  primaryBranchId,
  assertStaffBranchOperational,
} from '../utils/branchScope.js';

export const STAFF = STAFF_ROLES;

const clinicGateDenied = (req, res, extra = {}) =>
  res.status(403).json({
    success: false,
    message: extra.message || `Role '${req.user?.role || 'unknown'}' is not authorized for this action.`,
    ...extra,
  });

/** Clinic APIs: approved doctors only. Super Admin is rejected. */
export const requireClinicDoctor = (req, res, next) => {
  if (req.user?.role !== 'doctor') {
    return clinicGateDenied(req, res);
  }
  if (!isApprovedDoctor(req.user)) {
    const status = req.user.approvalStatus || 'pending';
    return clinicGateDenied(req, res, {
      message:
        status === 'suspended'
          ? 'Your doctor account is suspended.'
          : 'Your doctor account is awaiting admin approval.',
      approvalStatus: status,
    });
  }
  next();
};

/** Clinic APIs: approved doctor, or staff with login enabled. Super Admin is rejected. */
export const requireClinicUser = (req, res, next) => {
  if (req.user?.role === 'super_admin') {
    return clinicGateDenied(req, res);
  }
  if (req.user?.role === 'doctor') {
    return requireClinicDoctor(req, res, next);
  }
  if (isActiveStaffLogin(req.user)) {
    if (!req.user.clinicId) {
      return clinicGateDenied(req, res, { message: 'No clinic is associated with this account.' });
    }
    return next();
  }
  return clinicGateDenied(req, res, {
    message: 'Staff login is disabled. Ask a doctor to enable access.',
  });
};

export const requirePermission = (...perms) => (req, res, next) => {
  if (perms.some((p) => hasPermission(req.user, p))) return next();
  return res.status(403).json({
    success: false,
    message: 'You do not have permission for this action.',
  });
};

export const requireAnyPermission = (perms = []) => (req, res, next) => {
  if (hasAnyPermission(req.user, perms)) return next();
  return res.status(403).json({
    success: false,
    message: 'You do not have permission for this action.',
  });
};

/** Attach validated branch from X-Branch-Id / query. Never trusts client body.branchId. */
export const attachBranchContext = async (req, res, next) => {
  try {
    if (isStaffAccount(req.user)) {
      await assertStaffBranchOperational(req.user);
    }

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const requested = req.headers['x-branch-id'] || req.query.branchId || null;
    const raw =
      requested && String(requested) !== 'null' && String(requested) !== 'undefined' && String(requested) !== ''
        ? requested
        : null;

    if (raw) {
      req.branchId = await resolveRequestedBranchId(req.user, raw, { forWrite: mutating });
      return next();
    }

    if (isStaffAccount(req.user)) {
      // Staff never use All-branches — always lock to primary assignment.
      req.branchId = primaryBranchId(req.user) || getAccessibleBranchIds(req.user)[0] || null;
      return next();
    }

    req.branchId = null;
    next();
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error(err);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.',
    });
  });
};
