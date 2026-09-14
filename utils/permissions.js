/** Two authentication roles: super_admin (platform) and doctor (clinic admin). */

export const P = {
  PATIENTS_VIEW: 'patients.view',
  PATIENTS_MANAGE: 'patients.manage',
  APPOINTMENTS_VIEW: 'appointments.view',
  APPOINTMENTS_MANAGE: 'appointments.manage',
  CONSULTATION: 'consultation.perform',
  PRESCRIPTION: 'prescription.manage',
  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',
  REVENUE_OWN: 'revenue.own',
  REVENUE_ALL: 'revenue.all',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  MEDICINE_USE: 'medicine.use',
  MEDICINE_MANAGE: 'medicine.manage',
  BRANCHES_VIEW: 'branches.view',
  BRANCHES_MANAGE: 'branches.manage',
  STAFF_MANAGE: 'staff.manage',
  CAMPAIGNS_MANAGE: 'campaigns.manage',
  CONSENT_TEMPLATES: 'consent.templates',
  CONSENT_CAPTURE: 'consent.capture',
  PRINT_SETTINGS: 'print.settings',
  QUEUE_MANAGE: 'queue.manage',
  TEMPLATES_OWN: 'templates.own',
  TEMPLATES_CLINIC: 'templates.clinic',
  AUDIT_VIEW: 'audit.view',
  SEARCH: 'search.use',
};

/** Accounts that may log in. */
export const AUTH_ROLES = ['super_admin', 'doctor'];
export const LOGIN_ROLES = AUTH_ROLES;

/** Clinic staff job types — not authentication roles. */
export const STAFF_TYPES = ['receptionist', 'nurse', 'assistant', 'accountant', 'other'];

/**
 * Legacy User.role values still stored on staff records.
 * Kept so existing documents load; they cannot log in.
 */
export const LEGACY_STAFF_ROLES = ['clinic_admin', 'clinic_manager', 'receptionist', 'nurse', 'assistant'];

/** Clinic operational APIs: authenticated doctors only. */
export const STAFF_ROLES = ['doctor'];
export const CLINIC_AUTH_ROLES = ['doctor'];
export const ADMIN_ROLES = ['doctor'];
export const MANAGER_ROLES = ['doctor'];
export const FRONT_DESK_ROLES = ['doctor'];
export const CLINICAL_ROLES = ['doctor'];

const ALL = Object.values(P);

export const ROLE_PERMISSIONS = {
  super_admin: [],
  doctor: ALL,
};

/** Presets the Doctor can apply, then customize. Not authentication roles. */
export const STAFF_TYPE_PERMISSIONS = {
  receptionist: [
    P.PATIENTS_VIEW,
    P.PATIENTS_MANAGE,
    P.APPOINTMENTS_VIEW,
    P.APPOINTMENTS_MANAGE,
    P.BILLING_VIEW,
    P.BILLING_MANAGE,
    P.QUEUE_MANAGE,
    P.CONSENT_CAPTURE,
  ],
  nurse: [
    P.PATIENTS_VIEW,
    P.APPOINTMENTS_VIEW,
    P.QUEUE_MANAGE,
    P.CONSENT_CAPTURE,
    P.MEDICINE_USE,
  ],
  assistant: [P.PATIENTS_VIEW, P.APPOINTMENTS_VIEW, P.QUEUE_MANAGE],
  accountant: [P.BILLING_VIEW, P.BILLING_MANAGE, P.REVENUE_ALL],
  other: [],
};

export const PERMISSION_KEYS = ALL;

export const sanitizePermissions = (list) => {
  const allowed = new Set(ALL);
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((p) => allowed.has(p)))];
};

export const isSuperAdmin = (user) => user?.role === 'super_admin';
export const isDoctor = (user) => user?.role === 'doctor';
export const isApprovedDoctor = (user) =>
  isDoctor(user) && user.approvalStatus === 'approved' && user.isActive !== false;

/** Clinic staff record (not a platform auth role). */
export const isStaffAccount = (user) => {
  if (!user || user.role === 'super_admin' || user.role === 'doctor' || user.role === 'patient') {
    return false;
  }
  return Boolean(user.staffType) || LEGACY_STAFF_ROLES.includes(user.role);
};

export const isActiveStaffLogin = (user) =>
  isStaffAccount(user) &&
  user.loginEnabled === true &&
  user.isActive !== false &&
  user.staffStatus !== 'suspended' &&
  user.staffStatus !== 'inactive';

export const effectivePermissions = (user) => {
  if (!user) return [];
  if (user.role === 'super_admin') return [];
  if (user.role === 'doctor') return ALL;
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return sanitizePermissions(user.permissions);
  }
  return [];
};

export const hasPermission = (user, permission) => {
  if (!user || !permission) return false;
  if (user.role === 'super_admin') return false;
  if (user.role === 'doctor') return true;
  const list = effectivePermissions(user);
  return list.includes(permission) || list.includes('*');
};

export const hasAnyPermission = (user, permissions = []) =>
  permissions.some((p) => hasPermission(user, p));
