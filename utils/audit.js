import AuditLog from '../models/AuditLog.js';

export const AUDIT = {
  INVOICE_CREATED: 'invoice_created',
  PAYMENT_RECEIVED: 'payment_received',
  PAYMENT_REFUNDED: 'payment_refunded',
  CONSULTATION_COMPLETED: 'consultation_completed',
  PRESCRIPTION_CREATED: 'prescription_created',
  STOCK_ADJUSTED: 'stock_adjusted',
  STAFF_CREATED: 'staff_created',
  STAFF_DISABLED: 'staff_disabled',
  STAFF_LOGIN_CHANGED: 'staff_login_changed',
  STAFF_PERMISSIONS: 'staff_permissions',
  CAMPAIGN_SENT: 'campaign_sent',
  BRANCH_CREATED: 'branch_created',
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  PATIENT_CREATED: 'patient_created',
  PATIENT_UPDATED: 'patient_updated',
};

export async function writeAudit({
  clinicId,
  branchId = null,
  actorId,
  action,
  entityType,
  entityId = null,
  detail = '',
  metadata = {},
}) {
  if (!clinicId || !actorId || !action) return null;
  try {
    return await AuditLog.create({
      clinicId,
      branchId,
      actorId,
      action,
      entityType: entityType || '',
      entityId,
      detail,
      metadata,
    });
  } catch (err) {
    console.warn('Audit log failed:', err.message);
    return null;
  }
}
