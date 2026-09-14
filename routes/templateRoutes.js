import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import { listTemplates, createTemplate, updateTemplate } from '../controllers/templateController.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/', requirePermission(P.TEMPLATES_OWN, P.TEMPLATES_CLINIC, P.CONSULTATION, P.PATIENTS_VIEW), listTemplates);
router.post('/', requirePermission(P.TEMPLATES_OWN, P.TEMPLATES_CLINIC), createTemplate);
router.patch('/:id', requirePermission(P.TEMPLATES_OWN, P.TEMPLATES_CLINIC), updateTemplate);

export default router;
