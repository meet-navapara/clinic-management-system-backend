import { Router } from 'express';
import {
  getDoctors,
  getDoctorById,
  getDoctorAvailability,
  getSpecializations,
} from '../controllers/doctorController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();

/** Practice-management only — no public doctor marketplace. */
router.use(protect);
router.use(authorize('doctor', 'clinic_admin', 'super_admin'));

router.get('/', getDoctors);
router.get('/specializations', getSpecializations);
router.get('/:id/availability', getDoctorAvailability);
router.get('/:id', getDoctorById);

export default router;
