import { Router } from 'express';
import {
  getDoctors,
  getDoctorById,
  getDoctorAvailability,
  getSpecializations,
} from '../controllers/doctorController.js';
import { protect } from '../middleware/auth.js';
import { requireClinicUser, requirePermission } from '../middleware/access.js';
import { P } from '../utils/permissions.js';

const router = Router();

/** Practice-management only — no public doctor marketplace. */
router.use(protect);
router.use(
  requireClinicUser,
  requirePermission(P.PATIENTS_VIEW, P.PATIENTS_MANAGE, P.APPOINTMENTS_VIEW, P.APPOINTMENTS_MANAGE)
);

router.get('/', getDoctors);
router.get('/specializations', getSpecializations);
router.get('/:id/availability', getDoctorAvailability);
router.get('/:id', getDoctorById);

export default router;
