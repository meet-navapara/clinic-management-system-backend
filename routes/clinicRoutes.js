import { Router } from 'express';
import { listClinics, getClinicById } from '../controllers/clinicController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();

// Clinic directory is authenticated — not a public enumeration surface.
router.get('/', protect, authorize('super_admin'), listClinics);
router.get('/:id', protect, getClinicById);

export default router;
