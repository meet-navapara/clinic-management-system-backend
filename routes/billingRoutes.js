import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  recordPayment,
  refundPayment,
  cancelInvoice,
  revenueSummary,
  patientBilling,
} from '../controllers/billingController.js';
import { paymentValidation, handleValidation } from '../middleware/validators.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/', requirePermission(P.BILLING_VIEW), listInvoices);
router.get('/revenue', requirePermission(P.REVENUE_OWN, P.REVENUE_ALL), revenueSummary);
router.get('/patient/:patientId', requirePermission(P.BILLING_VIEW), patientBilling);
router.post('/', requirePermission(P.BILLING_MANAGE), createInvoice);
router.get('/:id', requirePermission(P.BILLING_VIEW), getInvoice);
router.patch('/:id', requirePermission(P.BILLING_MANAGE), updateInvoice);
router.post(
  '/:id/payments',
  requirePermission(P.BILLING_MANAGE),
  paymentValidation,
  handleValidation,
  recordPayment
);
router.post('/:id/refund', requirePermission(P.BILLING_MANAGE), refundPayment);
router.post('/:id/cancel', requirePermission(P.BILLING_MANAGE), cancelInvoice);

export default router;
