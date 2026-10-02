import User from '../models/User.js';
import { toAuthUser } from '../utils/authUser.js';
import { asyncHandler } from '../middleware/access.js';
import {
  clinicQuery,
  assertSameClinic,
  resolveAssignableBranches,
  getAccessibleBranchIds,
  primaryBranchId,
} from '../utils/branchScope.js';
import { parsePagination, paginated, escapeRegex } from '../utils/pagination.js';
import {
  STAFF_TYPES,
  STAFF_TYPE_PERMISSIONS,
  sanitizePermissions,
  isStaffAccount,
  P,
} from '../utils/permissions.js';
import { writeAudit, AUDIT } from '../utils/audit.js';

const storedRoleForStaffType = (type) => {
  if (type === 'doctor') return 'doctor';
  if (type === 'receptionist' || type === 'nurse' || type === 'assistant') return type;
  return 'assistant';
};

const toId = (value) => {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
};

/** Staff actors must never receive branch-create rights. */
const sanitizeStaffGrantedPermissions = (list) =>
  sanitizePermissions(list).filter((p) => p !== P.BRANCHES_MANAGE);

function targetBranchIds(user) {
  return [
    ...(user.branchIds || []).map((b) => toId(b)),
    user.defaultBranchId ? toId(user.defaultBranchId) : null,
  ].filter(Boolean);
}

/** Ensure actor may view/edit this staff record (own branch for scoped users). */
function assertCanManageStaffTarget(actor, target) {
  if (String(target._id) === String(actor._id)) return;
  const allowed = getAccessibleBranchIds(actor);
  if (allowed === null) return;
  const targetBranches = targetBranchIds(target);
  const inScope = targetBranches.some((id) => allowed.includes(String(id)));
  if (!inScope) {
    const err = new Error('You do not have access to this staff member.');
    err.status = 403;
    throw err;
  }
}

/** Empty / All → every staff; a selected branch (including Main) → that branch only. */
async function resolveStaffListBranchFilter(req) {
  const allowed = getAccessibleBranchIds(req.user);
  const raw = req.query.branchId || req.branchId || null;

  if (Array.isArray(allowed)) {
    if (!allowed.length) return { mode: 'none' };
    if (raw && allowed.includes(toId(raw))) return { mode: 'one', branchId: toId(raw) };
    return { mode: 'many', branchIds: allowed };
  }

  if (!raw) return { mode: 'all' };
  return { mode: 'one', branchId: toId(raw) };
}

export const listStaff = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {
    ...clinicQuery(req.user),
    role: { $ne: 'super_admin' },
  };
  if (req.query.role === 'doctor') filter.role = 'doctor';
  else if (req.query.staffType) {
    filter.$or = [{ staffType: req.query.staffType }, { role: req.query.staffType }];
  }
  if (req.query.status) {
    if (req.query.status === 'inactive' || req.query.status === 'disabled') {
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { staffStatus: { $in: ['inactive', 'suspended'] } },
            { isActive: false },
          ],
        },
      ];
    } else if (req.query.status === 'suspended') filter.staffStatus = 'suspended';
    else if (req.query.status === 'active') {
      filter.isActive = { $ne: false };
      filter.staffStatus = 'active';
    }
  }

  const scope = await resolveStaffListBranchFilter(req);
  if (scope.mode === 'none') {
    filter._id = { $in: [] };
  } else if (scope.mode === 'one') {
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [{ branchIds: scope.branchId }, { defaultBranchId: scope.branchId }],
      },
    ];
  } else if (scope.mode === 'many') {
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { branchIds: { $in: scope.branchIds } },
          { defaultBranchId: { $in: scope.branchIds } },
          { _id: req.user._id },
        ],
      },
    ];
  }

  if (req.query.q?.trim()) {
    const q = escapeRegex(req.query.q.trim());
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { name: new RegExp(q, 'i') },
          { email: new RegExp(q, 'i') },
          { phone: new RegExp(q, 'i') },
        ],
      },
    ];
  }

  const [rows, total] = await Promise.all([
    User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('defaultBranchId', 'name isDefault')
      .populate('branchIds', 'name isDefault'),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    ...paginated({ items: rows.map(toAuthUser), total, page, limit }),
    staff: rows.map(toAuthUser),
  });
});

export const getStaff = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('-password')
    .populate('branchIds', 'name')
    .populate('defaultBranchId', 'name');
  if (!user) return res.status(404).json({ success: false, message: 'Staff not found.' });
  assertSameClinic(req.user, user.clinicId);

  try {
    assertCanManageStaffTarget(req.user, user);
  } catch (err) {
    return res.status(err.status || 403).json({ success: false, message: err.message });
  }

  res.json({ success: true, staff: toAuthUser(user), branches: user.branchIds });
});

export const createStaff = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, staffType, branchIds, defaultBranchId, permissions, customRoleName, joiningDate, loginEnabled } = req.body;
  const type = String(staffType || role || '').trim();
  const actorIsStaff = isStaffAccount(req.user);
  const isDoctor = type === 'doctor';

  // Branch staff may only create peer staff for their own branch — never doctors or other branches.
  if (actorIsStaff && isDoctor) {
    return res.status(403).json({
      success: false,
      message: 'Staff members cannot create doctor accounts. Ask a Main branch doctor.',
    });
  }
  if (!isDoctor && !STAFF_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: 'Invalid staff type.' });
  }

  const enableLogin = isDoctor ? true : Boolean(loginEnabled);
  if (enableLogin && (!password || String(password).length < 6)) {
    return res.status(400).json({
      success: false,
      message: 'Set a password of at least 6 characters to enable login.',
    });
  }
  if (isDoctor && (!password || String(password).length < 6)) {
    return res.status(400).json({
      success: false,
      message: 'Doctors require a password of at least 6 characters.',
    });
  }
  if (!phone || String(phone).trim().length < 8) {
    return res.status(400).json({ success: false, message: 'A valid phone number is required.' });
  }

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) return res.status(409).json({ success: false, message: 'Email already registered.' });

  const savedPermissions = isDoctor
    ? []
    : sanitizeStaffGrantedPermissions(
        Array.isArray(permissions) && permissions.length
          ? permissions
          : enableLogin
            ? STAFF_TYPE_PERMISSIONS[type] || []
            : []
      );

  let requestedBranchIds = branchIds || (req.branchId ? [req.branchId] : []);
  let requestedDefault = defaultBranchId || req.branchId || null;

  // Staff actors are forced to their own primary branch.
  if (actorIsStaff) {
    const locked = primaryBranchId(req.user);
    if (!locked) {
      return res.status(403).json({
        success: false,
        message: 'No branch is assigned to this account. Ask a doctor to assign a branch.',
      });
    }
    requestedBranchIds = [locked];
    requestedDefault = locked;
  }

  let assigned = await resolveAssignableBranches(
    req.user.clinicId,
    requestedBranchIds,
    requestedDefault,
    { actor: req.user }
  );

  const allowedBranches = getAccessibleBranchIds(req.user);
  const creatorScoped = Array.isArray(allowedBranches);

  // Scoped branch doctors default new staff to their own branch when none selected.
  if (creatorScoped && !assigned.branchIds.length && allowedBranches[0]) {
    assigned = await resolveAssignableBranches(
      req.user.clinicId,
      [allowedBranches[0]],
      allowedBranches[0],
      { actor: req.user }
    );
  }

  if (!isDoctor && !assigned.branchIds.length) {
    return res.status(400).json({ success: false, message: 'Assign this staff member to a branch.' });
  }
  if (isDoctor && creatorScoped && !assigned.branchIds.length) {
    return res.status(400).json({
      success: false,
      message: 'Assign this doctor to your branch.',
    });
  }

  // Non-login staff still need a stored password hash — use a random unusable secret.
  const crypto = await import('crypto');
  const passwordToStore =
    password ||
    crypto.randomBytes(24).toString('base64url');

  const user = await User.create({
    name,
    email,
    password: passwordToStore,
    phone: String(phone).trim(),
    role: storedRoleForStaffType(type),
    staffType: isDoctor ? '' : type,
    clinicId: req.user.clinicId,
    branchIds: assigned.branchIds,
    defaultBranchId: assigned.defaultBranchId,
    permissions: savedPermissions,
    customRoleName: customRoleName || '',
    joiningDate: joiningDate || new Date(),
    staffStatus: 'active',
    isActive: true,
    loginEnabled: enableLogin,
    // Login-capable accounts must verify email via OTP before first sign-in.
    emailVerified: false,
    // Doctors created via Staff stay pending until a clinic doctor approves them.
    approvalStatus: isDoctor ? 'pending' : 'approved',
  });

  await writeAudit({
    clinicId: req.user.clinicId,
    branchId: user.defaultBranchId,
    actorId: req.user._id,
    action: AUDIT.STAFF_CREATED,
    entityType: 'User',
    entityId: user._id,
    detail: `${user.name} (${isDoctor ? 'doctor' : type})${enableLogin ? ' login on' : ''}`,
  });

  res.status(201).json({ success: true, staff: toAuthUser(user) });
});

export const updateStaff = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'Staff not found.' });
  assertSameClinic(req.user, user.clinicId);
  if (user.role === 'super_admin') {
    return res.status(403).json({ success: false, message: 'Cannot modify this account.' });
  }
  try {
    assertCanManageStaffTarget(req.user, user);
  } catch (err) {
    return res.status(err.status || 403).json({ success: false, message: err.message });
  }

  const actorIsStaff = isStaffAccount(req.user);
  if (String(user._id) === String(req.user._id) && req.body.staffStatus && req.body.staffStatus !== 'active') {
    return res.status(400).json({ success: false, message: 'You cannot disable your own account.' });
  }

  const fields = ['name', 'phone', 'customRoleName', 'joiningDate', 'specialization', 'qualification', 'consultationFee'];
  for (const field of fields) {
    if (req.body[field] !== undefined) user[field] = req.body[field];
  }
  if (req.body.branchIds || req.body.defaultBranchId !== undefined) {
    let nextBranchIds = req.body.branchIds || user.branchIds;
    let nextDefault =
      req.body.defaultBranchId !== undefined ? req.body.defaultBranchId : user.defaultBranchId;
    if (actorIsStaff) {
      const locked = primaryBranchId(req.user);
      nextBranchIds = [locked];
      nextDefault = locked;
    }
    const existingIds = targetBranchIds(user);
    const assigned = await resolveAssignableBranches(
      req.user.clinicId,
      nextBranchIds,
      nextDefault,
      { allowPreserveIds: existingIds, actor: req.user }
    );
    if (user.role !== 'doctor' && !assigned.branchIds.length) {
      return res.status(400).json({ success: false, message: 'Assign this staff member to a branch.' });
    }
    user.branchIds = assigned.branchIds;
    user.defaultBranchId = assigned.defaultBranchId;
  }
  if (Array.isArray(req.body.permissions) && user.role !== 'doctor') {
    user.permissions = sanitizeStaffGrantedPermissions(req.body.permissions);
    await writeAudit({
      clinicId: user.clinicId,
      actorId: req.user._id,
      action: AUDIT.STAFF_PERMISSIONS,
      entityType: 'User',
      entityId: user._id,
      detail: `${user.name} permissions updated (${user.permissions.length})`,
    });
  }

  const nextType = req.body.staffType || req.body.role;
  if (nextType === 'doctor') {
    if (actorIsStaff) {
      return res.status(403).json({
        success: false,
        message: 'Staff members cannot promote accounts to doctor.',
      });
    }
    const wasDoctor = user.role === 'doctor';
    user.role = 'doctor';
    user.staffType = '';
    user.loginEnabled = true;
    // Promoting staff → doctor requires clinic-doctor approval before dashboard access.
    if (!wasDoctor) {
      user.approvalStatus = 'pending';
      user.isActive = true;
      user.staffStatus = 'active';
      if (user.emailVerified !== true) user.emailVerified = false;
    }
  } else if (nextType && STAFF_TYPES.includes(nextType) && user.role !== 'doctor') {
    user.staffType = nextType;
    user.role = storedRoleForStaffType(nextType);
  }
  if (req.body.password) {
    if (String(req.body.password).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    user.password = req.body.password;
  }

  if (req.body.loginEnabled !== undefined && user.role !== 'doctor' && user.role !== 'super_admin') {
    const nextLogin = Boolean(req.body.loginEnabled);
    const enablingLogin = nextLogin && user.loginEnabled !== true;
    if (enablingLogin && !req.body.password) {
      return res.status(400).json({
        success: false,
        message: 'Set a unique password when enabling staff login.',
      });
    }
    if (user.loginEnabled !== nextLogin) {
      await writeAudit({
        clinicId: user.clinicId,
        actorId: req.user._id,
        action: AUDIT.STAFF_LOGIN_CHANGED,
        entityType: 'User',
        entityId: user._id,
        detail: `${user.name} login ${nextLogin ? 'enabled' : 'disabled'}`,
      });
    }
    user.loginEnabled = nextLogin;
    if (nextLogin) {
      // Re-enable requires email verification again when login was off / newly enabled.
      if (enablingLogin) user.emailVerified = false;
    }
    if (nextLogin && (!user.permissions || user.permissions.length === 0)) {
      user.permissions = sanitizeStaffGrantedPermissions(STAFF_TYPE_PERMISSIONS[user.staffType] || []);
    }
  }

  if (req.body.staffStatus) {
    if (actorIsStaff && user.role === 'doctor') {
      return res.status(403).json({
        success: false,
        message: 'Staff members cannot approve or suspend doctors.',
      });
    }
    user.staffStatus = req.body.staffStatus;
    user.isActive = req.body.staffStatus === 'active';
    if (user.role === 'doctor') {
      // Clinic doctor (admin) may approve additional doctors they added.
      user.approvalStatus = req.body.staffStatus === 'active' ? 'approved' : 'suspended';
    }
    if (req.body.staffStatus !== 'active') {
      await writeAudit({
        clinicId: user.clinicId,
        actorId: req.user._id,
        action: AUDIT.STAFF_DISABLED,
        entityType: 'User',
        entityId: user._id,
        detail: `${user.name} → ${req.body.staffStatus}`,
      });
    } else if (user.role === 'doctor') {
      await writeAudit({
        clinicId: user.clinicId,
        actorId: req.user._id,
        action: AUDIT.STAFF_PERMISSIONS,
        entityType: 'User',
        entityId: user._id,
        detail: `${user.name} doctor approved`,
      });
    }
  }

  await user.save();
  res.json({ success: true, staff: toAuthUser(user) });
});

export const roleCatalog = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    roles: [
      { id: 'doctor', label: 'Doctor', login: true, permissions: [] },
      ...STAFF_TYPES.map((id) => ({
        id,
        label: id.replace(/_/g, ' '),
        login: true,
        permissions: STAFF_TYPE_PERMISSIONS[id] || [],
      })),
    ],
  });
});
