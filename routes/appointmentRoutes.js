import { Router } from 'express';
import {
  createAppointment,
  getMyAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  rescheduleAppointment,
  getWhatsAppLink,
  findClinicPatient,
  getDoctorDashboardStats,
} from '../controllers/appointmentController.js';
import { protect, authorize, requireApprovedDoctor } from '../middleware/auth.js';
import { appointmentValidation, handleValidation } from '../middleware/validators.js';

const router = Router();

router.use(protect);

router.get(
  '/dashboard-stats',
  authorize('doctor'),
  requireApprovedDoctor,
  getDoctorDashboardStats
);

router.get(
  '/patients/search',
  authorize('doctor', 'clinic_admin', 'super_admin'),
  requireApprovedDoctor,
  findClinicPatient
);

router.post(
  '/',
  authorize('doctor', 'clinic_admin', 'super_admin'),
  requireApprovedDoctor,
  appointmentValidation,
  handleValidation,
  createAppointment
);
router.get('/my', authorize('doctor', 'clinic_admin', 'super_admin'), getMyAppointments);
router.get('/:id', authorize('doctor', 'clinic_admin', 'super_admin'), getAppointmentById);
router.patch('/:id/status', authorize('doctor', 'clinic_admin', 'super_admin'), updateAppointmentStatus);
router.patch(
  '/:id/reschedule',
  authorize('doctor', 'clinic_admin', 'super_admin'),
  requireApprovedDoctor,
  rescheduleAppointment
);
router.get('/:id/whatsapp', authorize('doctor', 'clinic_admin', 'super_admin'), getWhatsAppLink);

export default router;
