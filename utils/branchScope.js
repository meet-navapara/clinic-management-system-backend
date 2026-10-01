import Branch from '../models/Branch.js';
import { ADMIN_ROLES, isStaffAccount } from './permissions.js';

const toId = (value) => {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    // Populated doc { _id }
    if (value._id != null && value._id !== value) return toId(value._id);
    // Mongoose ObjectId — prefer toString() (avoid Buffer from .id)
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const asString = value.toString();
      if (asString && asString !== '[object Object]') return asString;
    }
    if (value.id != null && typeof value.id !== 'object') return String(value.id);
    return '';
  }
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

/** Assigned branch ids on the user document (branchIds ∪ defaultBranchId). */
export const assignedBranchIds = (user) => {
  const ids = [...(user?.branchIds || [])];
  if (user?.defaultBranchId) ids.push(user.defaultBranchId);
  return [...new Set(ids.map(toId).filter(Boolean))];
};

/**
 * Attach resolved scope onto the user object for sync helpers in this request.
 * `null` means clinic-wide (all branches).
 */
export const attachAccessibleBranches = (user, ids) => {
  if (!user) return;
  Object.defineProperty(user, '_accessibleBranchIds', {
    value: ids,
    writable: true,
    enumerable: false,
    configurable: true,
  });
};

/**
 * Resolve branch access for the current user (async — needs Branch.isDefault).
 *
 * Rules:
 * - Staff → primary branch only
 * - Doctor with no assignment → clinic-wide (owner / legacy)
 * - Doctor whose assignment includes the Main (`isDefault`) branch → clinic-wide access
 *   (can use branch switcher: All branches, or filter to any one branch including Main)
 * - Doctor assigned only to non-main branch(es) → those branches only
 */
export const resolveAccessibleBranchIds = async (user) => {
  if (!user) return [];
  if (isStaffAccount(user)) {
    const primary = primaryBranchId(user);
    return primary ? [primary] : [];
  }
  if (user.role !== 'doctor') {
    if (ADMIN_ROLES.includes(user.role)) return null;
    return assignedBranchIds(user);
  }

  const assigned = assignedBranchIds(user);
  if (!assigned.length) return null;

  const branches = await Branch.find({
    _id: { $in: assigned },
    clinicId: user.clinicId,
  }).select('_id isDefault');

  if (!branches.length) return null;
  if (branches.some((b) => b.isDefault)) return null;
  return branches.map((b) => toId(b._id));
};

/**
 * Sync accessor. Prefer values set by attachBranchContext / resolveAccessibleBranchIds.
 * Doctor without resolution yet → clinic-wide (safe default; attach runs on clinic routes).
 */
export const getAccessibleBranchIds = (user) => {
  if (!user) return [];
  if (Object.prototype.hasOwnProperty.call(user, '_accessibleBranchIds')) {
    return user._accessibleBranchIds;
  }
  if (isStaffAccount(user)) {
    const primary = primaryBranchId(user);
    return primary ? [primary] : [];
  }
  if (user.role === 'doctor' || ADMIN_ROLES.includes(user.role)) return null;
  return assignedBranchIds(user);
};

export const canAccessBranch = (user, branchId) => {
  if (!branchId) return getAccessibleBranchIds(user) === null;
  const allowed = getAccessibleBranchIds(user);
  if (allowed === null) return true;
  return allowed.includes(toId(branchId));
};

/**
 * Resolve a requested branch (header/query). Never trust the client:
 * clinic-wide doctors may pick any in-clinic branch; scoped doctors / staff only theirs.
 */
export const resolveRequestedBranchId = async (user, requestedBranchId, { forWrite = false } = {}) => {
  if (!requestedBranchId) return null;

  if (isStaffAccount(user)) {
    return resolveStaffBranchId(user, { forWrite });
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
 * Staff: missing branchId is denied (no leak via null) — legacy rows with no branchId allowed.
 * Doctor: missing branchId allowed for legacy clinic-wide rows.
 */
export const assertBranchAccess = (user, resourceBranchId) => {
  if (!resourceBranchId) return;
  if (!canAccessBranch(user, resourceBranchId)) {
    throw scopeError(403, 'You do not have access to this branch.');
  }
};

/**
 * Resolve a staff member's single operational branch (ignores client headers).
 * Uses clinicId + branch id together so mismatched assignments fail clearly at login.
 */
export const resolveStaffBranchId = async (user, { forWrite = false } = {}) => {
  const primary = primaryBranchId(user);
  if (!primary) {
    throw scopeError(403, 'No branch is assigned to this account. Ask a doctor to assign a branch.');
  }
  const branch = await Branch.findOne({
    _id: primary,
    clinicId: user.clinicId,
  }).select('_id isActive clinicId');
  if (!branch) {
    throw scopeError(403, 'No branch is assigned to this account. Ask a doctor to assign a branch.');
  }
  if (branch.isActive === false) {
    throw scopeError(
      403,
      forWrite
        ? 'This branch is disabled. New records cannot be created for it.'
        : 'Your assigned branch is disabled. Contact the clinic doctor.'
    );
  }
  return branch._id;
};

/** Block staff whose assigned branches are missing or all disabled. */
export const assertStaffBranchOperational = async (user) => {
  if (!isStaffAccount(user)) return;
  await resolveStaffBranchId(user, { forWrite: false });
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
 * Staff: always their primary branch.
 * Clinic-wide doctor: selected header branch, otherwise clinic Main.
 * Scoped doctor: selected header branch, otherwise their primary/first assigned branch.
 */
export const resolveWriteBranchId = async (user, resolvedBranchId) => {
  let branchId = null;

  if (isStaffAccount(user)) {
    branchId = primaryBranchId(user);
  } else {
    branchId = resolvedBranchId || null;
    if (!branchId) {
      const allowed = getAccessibleBranchIds(user);
      if (allowed === null) {
        const defaultBranch =
          (await Branch.findOne({ clinicId: user.clinicId, isDefault: true, isActive: true })) ||
          (await Branch.findOne({ clinicId: user.clinicId, isActive: true }).sort({ createdAt: 1 }));
        branchId = defaultBranch?._id || null;
      } else {
        const primary = primaryBranchId(user);
        branchId =
          (primary && allowed.includes(toId(primary)) ? primary : null) || allowed[0] || null;
      }
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
 * When actor is provided, assignee branch must be within actor's accessible set.
 */
export const resolveAssignableBranches = async (
  clinicId,
  branchIds = [],
  defaultBranchId = null,
  { allowPreserveIds = [], actor = null } = {}
) => {
  const ids = [...new Set([...(branchIds || []), defaultBranchId].map(toId).filter(Boolean))];
  if (!ids.length) {
    return { branchIds: [], defaultBranchId: null };
  }
  const primary = toId(defaultBranchId) && ids.includes(toId(defaultBranchId)) ? toId(defaultBranchId) : ids[0];
  const preserve = new Set((allowPreserveIds || []).map(toId).filter(Boolean));
  const branches = await Branch.find({ _id: { $in: [primary] }, clinicId }).select('_id isActive isDefault');
  if (branches.length !== 1) {
    throw scopeError(400, 'One or more branches are outside this clinic.');
  }
  if (branches[0].isActive === false && !preserve.has(primary)) {
    throw scopeError(400, 'Cannot assign staff to a disabled branch.');
  }
  if (actor && !canAccessBranch(actor, primary)) {
    throw scopeError(403, 'You can only assign staff to your own branch.');
  }
  return { branchIds: [primary], defaultBranchId: branches[0]._id };
};
