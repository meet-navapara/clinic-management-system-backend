import { hasPermission, hasAnyPermission, STAFF_ROLES, isApprovedDoctor, isActiveStaffLogin, isStaffAccount } from '../utils/permissions.js';
import {
  resolveRequestedBranchId,
  getAccessibleBranchIds,
  resolveStaffBranchId,
  assertStaffBranchOperational,
  resolveAccessibleBranchIds,
  attachAccessibleBranches,
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

    // Resolve doctor Main=all vs scoped-branch once per request.
    const accessible = await resolveAccessibleBranchIds(req.user);
    attachAccessibleBranches(req.user, accessible);
    req.accessibleBranchIds = accessible;
    req.clinicWideAccess = accessible === null;

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

    // Staff: always lock to assigned primary branch (ignore stale X-Branch-Id from prior doctor session).
    if (isStaffAccount(req.user)) {
      req.branchId = await resolveStaffBranchId(req.user, { forWrite: mutating });
      return next();
    }

    const requested = req.headers['x-branch-id'] || req.query.branchId || null;
    const raw =
      requested && String(requested) !== 'null' && String(requested) !== 'undefined' && String(requested) !== ''
        ? requested
        : null;

    if (raw) {
      req.branchId = await resolveRequestedBranchId(req.user, raw, { forWrite: mutating });
      return next();
    }

    // Scoped doctor with a single branch: lock filter to that branch when no header.
    if (Array.isArray(accessible) && accessible.length === 1) {
      req.branchId = accessible[0];
      return next();
    }

    // Clinic-wide doctor (Main) or multi-branch: null = all accessible branches.
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
