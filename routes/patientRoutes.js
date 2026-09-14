import { Router } from 'express';
import {
  createPatient,
  listMyPatients,
  getPatientById,
  updatePatient,
  addPatientNote,
} from '../controllers/patientController.js';
import { protect } from '../middleware/auth.js';
import { requireClinicUser, requirePermission, attachBranchContext } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  patientCreateValidation,
  patientUpdateValidation,
  handleValidation,
} from '../middleware/validators.js';

const router = Router();

router.use(protect, requireClinicUser, attachBranchContext);

router.post('/', requirePermission(P.PATIENTS_MANAGE), patientCreateValidation, handleValidation, createPatient);
router.get('/', requirePermission(P.PATIENTS_VIEW), listMyPatients);
router.get('/:id', requirePermission(P.PATIENTS_VIEW), getPatientById);
router.put('/:id', requirePermission(P.PATIENTS_MANAGE), patientUpdateValidation, handleValidation, updatePatient);
router.post('/:id/notes', requirePermission(P.PATIENTS_MANAGE, P.CONSULTATION), addPatientNote);

export default router;
