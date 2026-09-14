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
import { requireClinicUser, requirePermission, attachBranchContext } from '../middleware/access.js';
import { appointmentValidation, handleValidation } from '../middleware/validators.js';
import { P } from '../utils/permissions.js';

const router = Router();

router.use(protect, requireClinicUser, attachBranchContext);

router.get(
  '/dashboard-stats',
  authorize('doctor'),
  requireApprovedDoctor,
  getDoctorDashboardStats
);

router.get(
  '/patients/search',
  requireClinicUser,
  requirePermission(P.PATIENTS_VIEW, P.APPOINTMENTS_MANAGE),
  findClinicPatient
);

router.post(
  '/',
  requireClinicUser,
  requirePermission(P.APPOINTMENTS_MANAGE),
  appointmentValidation,
  handleValidation,
  createAppointment
);
router.get('/my', requireClinicUser, requirePermission(P.APPOINTMENTS_VIEW), getMyAppointments);
router.get('/:id', requireClinicUser, requirePermission(P.APPOINTMENTS_VIEW), getAppointmentById);
router.patch(
  '/:id/status',
  requireClinicUser,
  requirePermission(P.APPOINTMENTS_MANAGE),
  updateAppointmentStatus
);
router.patch(
  '/:id/reschedule',
  requireClinicUser,
  requirePermission(P.APPOINTMENTS_MANAGE),
  rescheduleAppointment
);
router.get('/:id/whatsapp', requireClinicUser, requirePermission(P.APPOINTMENTS_VIEW), getWhatsAppLink);

export default router;
