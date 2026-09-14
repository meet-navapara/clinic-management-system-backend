import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicDoctor } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import { listStaff, getStaff, createStaff, updateStaff, roleCatalog } from '../controllers/staffController.js';
import { staffCreateValidation, handleValidation } from '../middleware/validators.js';

const router = Router();
router.use(protect, requireClinicDoctor, attachBranchContext);

router.get('/roles', requirePermission(P.STAFF_MANAGE), roleCatalog);
router.get('/', requirePermission(P.STAFF_MANAGE), listStaff);
router.post('/', requirePermission(P.STAFF_MANAGE), staffCreateValidation, handleValidation, createStaff);
router.get('/:id', requirePermission(P.STAFF_MANAGE), getStaff);
router.patch('/:id', requirePermission(P.STAFF_MANAGE), updateStaff);

export default router;
