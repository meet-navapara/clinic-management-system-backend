import { Router } from 'express';
import {
  createAppointment,
  getMyAppointments,
  updateAppointmentStatus,
  getWhatsAppLink,
  findClinicPatient,
} from '../controllers/appointmentController.js';
import { protect, authorize } from '../middleware/auth.js';
import { appointmentValidation, handleValidation } from '../middleware/validators.js';

const router = Router();

router.use(protect);

router.get(
  '/patients/search',
  authorize('receptionist', 'clinic_admin', 'super_admin'),
  findClinicPatient
);

router.post(
  '/',
  authorize('patient', 'receptionist', 'clinic_admin', 'super_admin'),
  appointmentValidation,
  handleValidation,
  createAppointment
);
router.get('/my', getMyAppointments);
router.patch('/:id/status', updateAppointmentStatus);
router.get('/:id/whatsapp', getWhatsAppLink);

export default router;
