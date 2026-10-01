import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import { listStaff, getStaff, createStaff, updateStaff, roleCatalog } from '../controllers/staffController.js';
import { staffCreateValidation, handleValidation } from '../middleware/validators.js';

const router = Router();
// Doctors (Main = all staff) and staff with staff.manage (own branch only).
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/roles', requirePermission(P.STAFF_MANAGE), roleCatalog);
router.get('/', requirePermission(P.STAFF_MANAGE), listStaff);
router.post('/', requirePermission(P.STAFF_MANAGE), staffCreateValidation, handleValidation, createStaff);
router.get('/:id', requirePermission(P.STAFF_MANAGE), getStaff);
router.patch('/:id', requirePermission(P.STAFF_MANAGE), updateStaff);

export default router;
