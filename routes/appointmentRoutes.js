import { Router } from 'express';
import {
  createAppointment,
  getMyAppointments,
  updateAppointmentStatus,
  getWhatsAppLink,
} from '../controllers/appointmentController.js';
import { protect, authorize } from '../middleware/auth.js';
import { appointmentValidation } from '../middleware/validators.js';

const router = Router();

router.use(protect);

router.post('/', authorize('patient'), appointmentValidation, createAppointment);
router.get('/my', getMyAppointments);
router.patch('/:id/status', updateAppointmentStatus);
router.get('/:id/whatsapp', getWhatsAppLink);

export default router;
