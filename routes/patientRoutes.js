import { Router } from 'express';
import {
  createPatient,
  listMyPatients,
  getPatientById,
  updatePatient,
  addPatientNote,
} from '../controllers/patientController.js';
import { protect, authorize, requireApprovedDoctor } from '../middleware/auth.js';

const router = Router();

router.use(protect);

router.post('/', authorize('doctor'), requireApprovedDoctor, createPatient);
router.get('/', authorize('doctor'), requireApprovedDoctor, listMyPatients);
router.get('/:id', authorize('doctor', 'clinic_admin', 'super_admin'), getPatientById);
router.put('/:id', authorize('doctor'), requireApprovedDoctor, updatePatient);
router.post('/:id/notes', authorize('doctor'), requireApprovedDoctor, addPatientNote);

export default router;
