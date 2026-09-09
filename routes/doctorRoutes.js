import { Router } from 'express';
import {
  getDoctors,
  getDoctorById,
  getDoctorAvailability,
  getSpecializations,
} from '../controllers/doctorController.js';

const router = Router();

router.get('/', getDoctors);
router.get('/specializations', getSpecializations);
router.get('/:id', getDoctorById);
router.get('/:id/availability', getDoctorAvailability);

export default router;
