import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  upsertConsultation,
  getConsultation,
  getByAppointment,
  listPatientConsultations,
} from '../controllers/consultationController.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.post('/', requirePermission(P.CONSULTATION), upsertConsultation);
router.get('/appointment/:appointmentId', requirePermission(P.CONSULTATION, P.PATIENTS_VIEW), getByAppointment);
router.get('/patient/:patientId', requirePermission(P.CONSULTATION, P.PATIENTS_VIEW), listPatientConsultations);
router.get('/:id', requirePermission(P.CONSULTATION, P.PATIENTS_VIEW), getConsultation);

export default router;
