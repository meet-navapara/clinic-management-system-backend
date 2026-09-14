import { Router } from 'express';
import {
  listClinicDoctors,
  getDoctorDetail,
  setDoctorApproval,
  getAdminDashboard,
} from '../controllers/adminController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();

router.use(protect);
router.use(authorize('super_admin'));

router.get('/dashboard', getAdminDashboard);
router.get('/doctors', listClinicDoctors);
router.get('/doctors/:id', getDoctorDetail);
router.patch('/doctors/:id/approval', setDoctorApproval);

export default router;
