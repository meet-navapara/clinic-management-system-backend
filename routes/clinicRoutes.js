import { Router } from 'express';
import { listClinics, getClinicById } from '../controllers/clinicController.js';

const router = Router();

router.get('/', listClinics);
router.get('/:id', getClinicById);

export default router;
