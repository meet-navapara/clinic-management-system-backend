import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeInvoiceTotals, paymentStatusFromAmounts, roundMoney } from '../utils/money.js';
import { hasPermission, P, ROLE_PERMISSIONS, effectivePermissions, AUTH_ROLES, isActiveStaffLogin } from '../utils/permissions.js';
import { getAccessibleBranchIds, canAccessBranch, clinicQuery, assertSameClinic, tenantFilter, branchQuery, primaryBranchId, assertBranchAccess } from '../utils/branchScope.js';
import { isSameClinic } from '../middleware/auth.js';
import { requireClinicDoctor, requireClinicUser } from '../middleware/access.js';

describe('invoice totals', () => {
  it('computes subtotal, discount, tax and total', () => {
    const r = computeInvoiceTotals({
      items: [
        { name: 'Consultation', quantity: 1, unitPrice: 500 },
        { name: 'Medicine', quantity: 2, unitPrice: 150 },
      ],
      discount: 50,
      taxRate: 0,
    });
    assert.equal(r.subtotal, 800);
    assert.equal(r.discount, 50);
    assert.equal(r.total, 750);
  });

  it('applies tax on discounted amount', () => {
    const r = computeInvoiceTotals({
      items: [{ name: 'Lab', quantity: 1, unitPrice: 1000 }],
      discount: 0,
      taxRate: 18,
    });
    assert.equal(r.tax, 180);
    assert.equal(r.total, 1180);
  });
});

describe('payment status', () => {
  it('marks unpaid / partial / paid', () => {
    assert.equal(paymentStatusFromAmounts(950, 0).paymentStatus, 'unpaid');
    assert.equal(paymentStatusFromAmounts(950, 400).paymentStatus, 'partially_paid');
    assert.equal(paymentStatusFromAmounts(950, 950).paymentStatus, 'paid');
    assert.equal(roundMoney(paymentStatusFromAmounts(950, 400).dueAmount), 550);
  });

  it('nets refunds out of paid and keeps refunded amount', () => {
    const afterRefund = paymentStatusFromAmounts(700, 500, 500);
    assert.equal(afterRefund.paymentStatus, 'refunded');
    assert.equal(afterRefund.paidAmount, 0);
    assert.equal(afterRefund.refundedAmount, 500);
    assert.equal(afterRefund.dueAmount, 700);

    const afterRepay = paymentStatusFromAmounts(700, 1100, 500);
    assert.equal(afterRepay.paymentStatus, 'partially_paid');
    assert.equal(afterRepay.paidAmount, 600);
    assert.equal(afterRepay.refundedAmount, 500);
    assert.equal(afterRepay.dueAmount, 100);

    const settled = paymentStatusFromAmounts(600, 1100, 500);
    assert.equal(settled.paymentStatus, 'paid');
    assert.equal(settled.paidAmount, 600);
    assert.equal(settled.dueAmount, 0);
    assert.equal(settled.refundedAmount, 500);
  });
});

describe('permissions', () => {
  it('super admin has no clinic operational permissions', () => {
    assert.equal(hasPermission({ role: 'super_admin' }, P.REVENUE_ALL), false);
    assert.equal(hasPermission({ role: 'super_admin' }, P.STAFF_MANAGE), false);
    assert.equal(hasPermission({ role: 'super_admin' }, P.BILLING_VIEW), false);
    assert.deepEqual(effectivePermissions({ role: 'super_admin' }), []);
  });

  it('doctor is clinic administrator and has clinic keys', () => {
    assert.equal(hasPermission({ role: 'doctor' }, P.REVENUE_ALL), true);
    assert.equal(hasPermission({ role: 'doctor' }, P.STAFF_MANAGE), true);
    assert.equal(hasPermission({ role: 'doctor' }, P.CAMPAIGNS_MANAGE), true);
    assert.equal(hasPermission({ role: 'doctor' }, P.BILLING_MANAGE), true);
    assert.equal(hasPermission({ role: 'doctor' }, P.CONSULTATION), true);
  });

  it('staff types are not platform login roles and have no doctor god-mode', () => {
    assert.equal(hasPermission({ role: 'receptionist' }, P.STAFF_MANAGE), false);
    assert.equal(hasPermission({ role: 'receptionist', permissions: [] }, P.BILLING_VIEW), false);
    assert.equal(
      hasPermission({ role: 'receptionist', staffType: 'receptionist', permissions: [P.BILLING_VIEW] }, P.BILLING_VIEW),
      true
    );
    assert.equal(
      hasPermission({ role: 'receptionist', staffType: 'receptionist', permissions: [P.BILLING_VIEW] }, P.REVENUE_ALL),
      false
    );
    assert.equal(ROLE_PERMISSIONS.super_admin.length, 0);
    assert.deepEqual(AUTH_ROLES, ['super_admin', 'doctor']);
  });
});

describe('branch access', () => {
  const doctor = { role: 'doctor', clinicId: 'c1', branchIds: ['b1'], defaultBranchId: 'b1' };

  it('doctor can access any branch in their clinic', () => {
    assert.equal(getAccessibleBranchIds(doctor), null);
    assert.equal(canAccessBranch(doctor, 'b2'), true);
    assert.deepEqual(tenantFilter(doctor, null), { clinicId: 'c1' });
    assert.deepEqual(tenantFilter(doctor, 'b1'), { clinicId: 'c1', branchId: 'b1' });
  });

  it('doctor all-branches query has no branch constraint', () => {
    assert.deepEqual(branchQuery(doctor, null), {});
  });
});

describe('clinic isolation', () => {
  it('does not treat Super Admin as same-clinic for operational records', () => {
    assert.equal(isSameClinic({ role: 'super_admin', clinicId: null }, 'clinic-a'), false);
    assert.equal(isSameClinic({ role: 'doctor', clinicId: 'clinic-a' }, 'clinic-b'), false);
    assert.equal(isSameClinic({ role: 'doctor', clinicId: 'clinic-a' }, 'clinic-a'), true);
  });

  it('scopes clinic queries to the doctor clinic only', () => {
    assert.deepEqual(clinicQuery({ role: 'super_admin', clinicId: null }), { clinicId: null });
    assert.deepEqual(clinicQuery({ role: 'doctor', clinicId: 'clinic-a' }), { clinicId: 'clinic-a' });
  });

  it('denies doctor A from clinic B records', () => {
    assert.throws(
      () => assertSameClinic({ role: 'doctor', clinicId: 'clinic-a' }, 'clinic-b'),
      /another clinic/
    );
  });
});

describe('clinic API gate', () => {
  const invoke = (user) =>
    new Promise((resolve) => {
      const req = { user };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ status: this.statusCode, body });
          return this;
        },
      };
      requireClinicDoctor(req, res, () => resolve({ status: 200, next: true }));
    });

  it('rejects Super Admin on clinic operations', async () => {
    const result = await invoke({ role: 'super_admin', approvalStatus: 'approved' });
    assert.equal(result.status, 403);
    assert.equal(result.next, undefined);
  });

  it('rejects staff types on clinic operations', async () => {
    const result = await invoke({ role: 'receptionist', staffType: 'receptionist', approvalStatus: 'approved' });
    assert.equal(result.status, 403);
  });

  it('allows an approved doctor', async () => {
    const result = await invoke({ role: 'doctor', approvalStatus: 'approved', isActive: true });
    assert.equal(result.next, true);
  });

  it('rejects a pending doctor', async () => {
    const result = await invoke({ role: 'doctor', approvalStatus: 'pending' });
    assert.equal(result.status, 403);
  });
});

describe('staff login gate', () => {
  const invokeUser = (user) =>
    new Promise((resolve) => {
      const req = { user };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ status: this.statusCode, body });
          return this;
        },
      };
      requireClinicUser(req, res, () => resolve({ status: 200, next: true }));
    });

  it('rejects staff without loginEnabled', async () => {
    assert.equal(isActiveStaffLogin({ role: 'receptionist', staffType: 'receptionist' }), false);
    const result = await invokeUser({
      role: 'receptionist',
      staffType: 'receptionist',
      clinicId: 'c1',
      loginEnabled: false,
    });
    assert.equal(result.status, 403);
  });

  it('allows staff with login enabled in their clinic', async () => {
    const result = await invokeUser({
      role: 'receptionist',
      staffType: 'receptionist',
      clinicId: 'c1',
      loginEnabled: true,
      isActive: true,
      staffStatus: 'active',
    });
    assert.equal(result.next, true);
  });

  it('rejects Super Admin via clinic user gate', async () => {
    const result = await invokeUser({ role: 'super_admin' });
    assert.equal(result.status, 403);
  });
});

describe('staff branch restriction', () => {
  const staff = {
    role: 'receptionist',
    staffType: 'receptionist',
    clinicId: 'c1',
    branchIds: ['b1'],
    defaultBranchId: 'b1',
  };

  it('limits staff to assigned branches', () => {
    assert.deepEqual(getAccessibleBranchIds(staff), ['b1']);
    assert.equal(canAccessBranch(staff, 'b1'), true);
    assert.equal(canAccessBranch(staff, 'b2'), false);
  });

  it('does not grant all-clinic data when staff has no branch assignment', () => {
    const unassigned = { role: 'receptionist', staffType: 'receptionist', clinicId: 'c1', branchIds: [] };
    assert.deepEqual(getAccessibleBranchIds(unassigned), []);
    assert.deepEqual(tenantFilter(unassigned, null), { clinicId: 'c1', branchId: { $in: [] } });
  });

  it('scopes staff queries to assigned branch', () => {
    assert.deepEqual(tenantFilter(staff, null), { clinicId: 'c1', branchId: { $in: ['b1'] } });
    assert.deepEqual(tenantFilter(staff, 'b1'), { clinicId: 'c1', branchId: 'b1' });
    assert.equal(primaryBranchId(staff), 'b1');
  });

  it('scopes multi-branch historical accounts to primary only', () => {
    const multi = {
      role: 'nurse',
      staffType: 'nurse',
      clinicId: 'c1',
      branchIds: ['b1', 'b2'],
      defaultBranchId: 'b1',
    };
    assert.deepEqual(getAccessibleBranchIds(multi), ['b1']);
    assert.deepEqual(branchQuery(multi, null), { branchId: { $in: ['b1'] } });
    assert.equal(canAccessBranch(multi, 'b2'), false);
    assert.equal(canAccessBranch(multi, 'b3'), false);
  });

  it('denies staff access when resource branchId is missing', () => {
    assert.throws(
      () => assertBranchAccess(staff, null),
      /do not have access/
    );
  });
});

