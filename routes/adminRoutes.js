import { Router } from 'express';
import {
  listClinicDoctors,
  getDoctorDetail,
  setDoctorApproval,
  getAdminDashboard,
  getClinicOverviewAppointments,
} from '../controllers/adminController.js';
import { protect, authorize, requireClinic } from '../middleware/auth.js';

const router = Router();

router.use(protect);
router.use(authorize('clinic_admin', 'super_admin'));
router.use((req, res, next) => {
  if (req.user.role === 'super_admin') return next();
  return requireClinic(req, res, next);
});

router.get('/dashboard', getAdminDashboard);
router.get('/appointments/recent', getClinicOverviewAppointments);
router.get('/doctors', listClinicDoctors);
router.get('/doctors/:id', getDoctorDetail);
router.patch('/doctors/:id/approval', setDoctorApproval);

export default router;
