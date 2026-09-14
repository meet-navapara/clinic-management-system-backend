import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser, requireClinicDoctor } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  assignStaffToBranch,
} from '../controllers/branchController.js';
import { branchCreateValidation, handleValidation } from '../middleware/validators.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/', requirePermission(P.BRANCHES_VIEW, P.QUEUE_MANAGE, P.BILLING_VIEW), listBranches);
router.post(
  '/',
  requireClinicDoctor,
  requirePermission(P.BRANCHES_MANAGE),
  branchCreateValidation,
  handleValidation,
  createBranch
);
router.get('/:id', requirePermission(P.BRANCHES_VIEW, P.BRANCHES_MANAGE), getBranch);
router.patch('/:id', requireClinicDoctor, requirePermission(P.BRANCHES_MANAGE), updateBranch);
router.post('/:id/assign', requireClinicDoctor, requirePermission(P.BRANCHES_MANAGE), assignStaffToBranch);

export default router;
