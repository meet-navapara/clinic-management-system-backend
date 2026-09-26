import Branch from '../models/Branch.js';
import User from '../models/User.js';
import { asyncHandler } from '../middleware/access.js';
import { clinicQuery, canAccessBranch, assertSameClinic } from '../utils/branchScope.js';
import { writeAudit, AUDIT } from '../utils/audit.js';
import { ADMIN_ROLES } from '../utils/permissions.js';

function normalizeRooms(input, fallbackLabel = 'Room 1') {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const cleaned = [];
  const seen = new Set();
  for (const raw of list) {
    const label = String(raw || '').trim().slice(0, 80);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(label);
  }
  if (cleaned.length) return cleaned;
  const fb = String(fallbackLabel || '').trim() || 'Room 1';
  return [fb];
}

export const listBranches = asyncHandler(async (req, res) => {
  const filter = { ...clinicQuery(req.user) };
  if (req.query.active !== 'all') {
    if (req.query.active === 'false') filter.isActive = false;
    else filter.isActive = true;
  }
  const branches = await Branch.find(filter).sort({ isDefault: -1, name: 1 }).populate('managerId', 'name email');
  const visible = ADMIN_ROLES.includes(req.user.role)
    ? branches
    : branches.filter((b) => canAccessBranch(req.user, b._id));
  res.json({ success: true, branches: visible });
});

export const getBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.findById(req.params.id).populate('managerId', 'name email phone');
  if (!branch) return res.status(404).json({ success: false, message: 'Branch not found.' });
  assertSameClinic(req.user, branch.clinicId);
  if (!canAccessBranch(req.user, branch._id)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this branch.' });
  }
  res.json({ success: true, branch });
});

export const createBranch = asyncHandler(async (req, res) => {
  const clinicId = req.user.clinicId;
  if (!clinicId) {
    return res.status(400).json({ success: false, message: 'No clinic on this account.' });
  }
  const exists = await Branch.countDocuments({ clinicId });
  const rooms = normalizeRooms(req.body.rooms, req.body.roomLabel || 'Room 1');
  const roomLabel = String(req.body.roomLabel || rooms[0] || 'Room 1').trim() || rooms[0];
  const branch = await Branch.create({
    clinicId,
    name: req.body.name,
    code: req.body.code || '',
    address: req.body.address || '',
    phone: req.body.phone || '',
    email: req.body.email || '',
    managerId: req.body.managerId || null,
    workingHours: req.body.workingHours || undefined,
    appointmentDuration: req.body.appointmentDuration || 30,
    logo: req.body.logo || '',
    displayTitle: req.body.displayTitle || '',
    roomLabel,
    rooms: rooms.includes(roomLabel) ? rooms : [roomLabel, ...rooms],
    isDefault: exists === 0,
    isActive: true,
  });
  await writeAudit({
    clinicId,
    branchId: branch._id,
    actorId: req.user._id,
    action: AUDIT.BRANCH_CREATED,
    entityType: 'Branch',
    entityId: branch._id,
    detail: branch.name,
  });
  res.status(201).json({ success: true, branch });
});

export const updateBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.findById(req.params.id);
  if (!branch) return res.status(404).json({ success: false, message: 'Branch not found.' });
  assertSameClinic(req.user, branch.clinicId);
  const fields = [
    'name',
    'code',
    'address',
    'phone',
    'email',
    'managerId',
    'workingHours',
    'appointmentDuration',
    'logo',
    'displayTitle',
    'isActive',
  ];
  for (const field of fields) {
    if (req.body[field] !== undefined) branch[field] = req.body[field];
  }
  if (req.body.rooms !== undefined || req.body.roomLabel !== undefined) {
    const rooms = normalizeRooms(
      req.body.rooms !== undefined ? req.body.rooms : branch.rooms,
      req.body.roomLabel || branch.roomLabel || 'Room 1'
    );
    const roomLabel =
      String(req.body.roomLabel || rooms[0] || branch.roomLabel || 'Room 1').trim() || rooms[0];
    branch.rooms = rooms.includes(roomLabel) ? rooms : [roomLabel, ...rooms];
    branch.roomLabel = roomLabel;
  }
  if (req.body.isDefault === true) {
    await Branch.updateMany(
      { clinicId: branch.clinicId, _id: { $ne: branch._id } },
      { $set: { isDefault: false } }
    );
    branch.isDefault = true;
  }

  if (req.body.isActive === false && branch.isActive !== false) {
    const activeCount = await Branch.countDocuments({
      clinicId: branch.clinicId,
      isActive: true,
    });
    if (activeCount <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate the last active branch.',
      });
    }
    const staffOnBranch = await User.countDocuments({
      clinicId: branch.clinicId,
      role: { $nin: ['doctor', 'super_admin', 'patient'] },
      $or: [{ defaultBranchId: branch._id }, { branchIds: branch._id }],
      loginEnabled: true,
    });
    if (staffOnBranch > 0) {
      return res.status(400).json({
        success: false,
        message: `Reassign ${staffOnBranch} staff member(s) before deactivating this branch.`,
      });
    }
    if (branch.isDefault) {
      const nextDefault = await Branch.findOne({
        clinicId: branch.clinicId,
        _id: { $ne: branch._id },
        isActive: true,
      }).sort({ createdAt: 1 });
      if (nextDefault) {
        nextDefault.isDefault = true;
        await nextDefault.save();
        branch.isDefault = false;
      }
    }
  }

  await branch.save();
  res.json({ success: true, branch });
});

export const assignStaffToBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.findById(req.params.id);
  if (!branch) return res.status(404).json({ success: false, message: 'Branch not found.' });
  assertSameClinic(req.user, branch.clinicId);
  if (branch.isActive === false) {
    return res.status(400).json({ success: false, message: 'Cannot assign staff to a disabled branch.' });
  }
  const { userIds = [], doctorIds = [] } = req.body;
  const ids = [...new Set([...userIds, ...doctorIds].map(String))];
  await User.updateMany(
    { _id: { $in: ids }, clinicId: branch.clinicId, role: { $ne: 'super_admin' } },
    {
      $set: { branchIds: [branch._id], defaultBranchId: branch._id },
    }
  );
  res.json({ success: true, message: 'Staff assigned to branch.' });
});
