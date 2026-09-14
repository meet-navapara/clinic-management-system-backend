import Branch from '../models/Branch.js';
import { ADMIN_ROLES, isStaffAccount } from './permissions.js';

const toId = (value) => {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
};

const scopeError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

export const primaryBranchId = (user) => {
  const def = toId(user?.defaultBranchId);
  if (def) return def;
  const ids = [...(user?.branchIds || [])].map(toId).filter(Boolean);
  return ids[0] || null;
};

/**
 * All branch ids the user may access, or null = every branch in their clinic (Doctor).
 * Staff: only their primary/default branch (one operational unit).
 */
export const getAccessibleBranchIds = (user) => {
  if (!user) return [];
  if (ADMIN_ROLES.includes(user.role)) return null;
  if (isStaffAccount(user)) {
    const primary = primaryBranchId(user);
    return primary ? [primary] : [];
  }
  const ids = [...(user.branchIds || [])];
  if (user.defaultBranchId) ids.push(user.defaultBranchId);
  return [...new Set(ids.map(toId).filter(Boolean))];
};

export const canAccessBranch = (user, branchId) => {
  if (!branchId) return ADMIN_ROLES.includes(user?.role);
  const allowed = getAccessibleBranchIds(user);
  if (allowed === null) return true;
  return allowed.includes(toId(branchId));
};

/**
 * Resolve a requested branch (header/query). Never trust the client:
 * doctors may pick any branch in-clinic; staff always use their primary branch.
 */
export const resolveRequestedBranchId = async (user, requestedBranchId, { forWrite = false } = {}) => {
  if (!requestedBranchId) return null;

  if (isStaffAccount(user)) {
    const primary = primaryBranchId(user);
    if (!primary) {
      throw scopeError(403, 'No branch is assigned to this account. Ask a doctor to assign a branch.');
    }
    // Ignore forged / secondary branch headers — staff cannot switch branches.
    if (toId(requestedBranchId) !== toId(primary)) {
      throw scopeError(403, 'You do not have access to this branch.');
    }
    const branch = await Branch.findById(primary).select('clinicId isActive');
    if (!branch) {
      throw scopeError(404, 'Branch not found.');
    }
    if (toId(branch.clinicId) !== toId(user.clinicId)) {
      throw scopeError(403, 'Branch is outside your clinic.');
    }
    if (forWrite && branch.isActive === false) {
      throw scopeError(403, 'This branch is disabled. New records cannot be created for it.');
    }
    return branch._id;
  }

  const branch = await Branch.findById(requestedBranchId).select('clinicId isActive');
  if (!branch) {
    throw scopeError(404, 'Branch not found.');
  }
  if (toId(branch.clinicId) !== toId(user.clinicId)) {
    throw scopeError(403, 'Branch is outside your clinic.');
  }
  if (!canAccessBranch(user, branch._id)) {
    throw scopeError(403, 'You do not have access to this branch.');
  }
  if (forWrite && branch.isActive === false) {
    throw scopeError(403, 'This branch is disabled. New records cannot be created for it.');
  }
  return branch._id;
};

/** Mongo filter fragment for branch-scoped collections. */
export const branchQuery = (user, resolvedBranchId) => {
  if (resolvedBranchId) return { branchId: resolvedBranchId };
  const allowed = getAccessibleBranchIds(user);
  if (allowed === null) return {};
  if (!allowed.length) return { branchId: { $in: [] } };
  return { branchId: { $in: allowed } };
};

export const clinicQuery = (user) => {
  if (!user) return { clinicId: null };
  return { clinicId: user.clinicId || null };
};

export const tenantFilter = (user, resolvedBranchId) => ({
  ...clinicQuery(user),
  ...branchQuery(user, resolvedBranchId),
});

export const assertSameClinic = (user, resourceClinicId) => {
  if (!resourceClinicId || toId(resourceClinicId) !== toId(user.clinicId)) {
    throw scopeError(403, 'This record belongs to another clinic.');
  }
};

/**
 * Staff: missing branchId is denied (no leak via null).
 * Doctor: missing branchId is allowed for legacy clinic-wide rows.
 */
export const assertBranchAccess = (user, resourceBranchId) => {
  if (!resourceBranchId) {
    if (isStaffAccount(user)) {
      throw scopeError(403, 'You do not have access to this branch.');
    }
    return;
  }
  if (!canAccessBranch(user, resourceBranchId)) {
    throw scopeError(403, 'You do not have access to this branch.');
  }
};

/** Block staff whose assigned branches are missing or all disabled. */
export const assertStaffBranchOperational = async (user) => {
  if (!isStaffAccount(user)) return;
  const primary = primaryBranchId(user);
  if (!primary) {
    throw scopeError(403, 'No branch is assigned to this account. Ask a doctor to assign a branch.');
  }
  const branch = await Branch.findOne({
    _id: primary,
    clinicId: user.clinicId,
  }).select('isActive');
  if (!branch) {
    throw scopeError(403, 'No branch is assigned to this account. Ask a doctor to assign a branch.');
  }
  if (branch.isActive === false) {
    throw scopeError(403, 'Your assigned branch is disabled. Contact the clinic doctor.');
  }
};

export const assertBranchAllowsWrites = async (branchId) => {
  if (!branchId) {
    throw scopeError(400, 'A branch is required.');
  }
  const branch = await Branch.findById(branchId).select('isActive clinicId');
  if (!branch) {
    throw scopeError(404, 'Branch not found.');
  }
  if (branch.isActive === false) {
    throw scopeError(403, 'This branch is disabled. New records cannot be created for it.');
  }
  return branch;
};

/**
 * Branch id used when creating operational records.
 * Staff: always their primary branch (client branchId / header is ignored).
 * Doctor: selected header branch, otherwise the clinic default/main branch.
 */
export const resolveWriteBranchId = async (user, resolvedBranchId) => {
  let branchId = null;

  if (isStaffAccount(user)) {
    branchId = primaryBranchId(user);
  } else {
    branchId = resolvedBranchId || null;
    if (!branchId) {
      const defaultBranch =
        (await Branch.findOne({ clinicId: user.clinicId, isDefault: true, isActive: true })) ||
        (await Branch.findOne({ clinicId: user.clinicId, isActive: true }).sort({ createdAt: 1 }));
      branchId = defaultBranch?._id || null;
    }
  }

  if (!branchId) {
    throw scopeError(400, 'A branch is required. Select a branch or assign one to this account.');
  }
  if (!canAccessBranch(user, branchId)) {
    throw scopeError(403, 'You do not have access to this branch.');
  }

  const branch = await assertBranchAllowsWrites(branchId);
  if (toId(branch.clinicId) !== toId(user.clinicId)) {
    throw scopeError(403, 'Branch is outside your clinic.');
  }
  return branch._id;
};

/**
 * Validate branch ids for staff assignment.
 * New assignments must be in-clinic and active.
 * When keeping an existing assignment that is now disabled, allowPreserveIds may include it.
 */
export const resolveAssignableBranches = async (
  clinicId,
  branchIds = [],
  defaultBranchId = null,
  { allowPreserveIds = [] } = {}
) => {
  const ids = [...new Set([...(branchIds || []), defaultBranchId].map(toId).filter(Boolean))];
  if (!ids.length) {
    return { branchIds: [], defaultBranchId: null };
  }
  // One primary branch for staff operational isolation.
  const primary = toId(defaultBranchId) && ids.includes(toId(defaultBranchId)) ? toId(defaultBranchId) : ids[0];
  const preserve = new Set((allowPreserveIds || []).map(toId).filter(Boolean));
  const branches = await Branch.find({ _id: { $in: [primary] }, clinicId }).select('_id isActive');
  if (branches.length !== 1) {
    throw scopeError(400, 'One or more branches are outside this clinic.');
  }
  if (branches[0].isActive === false && !preserve.has(primary)) {
    throw scopeError(400, 'Cannot assign staff to a disabled branch.');
  }
  return { branchIds: [primary], defaultBranchId: branches[0]._id };
};
