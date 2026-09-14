import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  listMedicines,
  searchMedicines,
  createMedicine,
  updateMedicine,
  getMedicine,
} from '../controllers/medicineController.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/search', requirePermission(P.MEDICINE_USE, P.MEDICINE_MANAGE), searchMedicines);
router.get('/', requirePermission(P.MEDICINE_USE, P.MEDICINE_MANAGE, P.INVENTORY_VIEW), listMedicines);
router.post('/', requirePermission(P.MEDICINE_MANAGE), createMedicine);
router.get('/:id', requirePermission(P.MEDICINE_USE, P.MEDICINE_MANAGE), getMedicine);
router.patch('/:id', requirePermission(P.MEDICINE_MANAGE), updateMedicine);

export default router;
