import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  listConsentTemplates,
  createConsentTemplate,
  updateConsentTemplate,
  assignConsent,
  signConsent,
  listConsentRecords,
  getConsentRecord,
} from '../controllers/consentController.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/templates', requirePermission(P.CONSENT_TEMPLATES, P.CONSENT_CAPTURE), listConsentTemplates);
router.post('/templates', requirePermission(P.CONSENT_TEMPLATES), createConsentTemplate);
router.patch('/templates/:id', requirePermission(P.CONSENT_TEMPLATES), updateConsentTemplate);
router.get('/records', requirePermission(P.CONSENT_CAPTURE, P.CONSENT_TEMPLATES), listConsentRecords);
router.post('/records', requirePermission(P.CONSENT_CAPTURE), assignConsent);
router.post('/records/:id/sign', requirePermission(P.CONSENT_CAPTURE), signConsent);
router.get('/records/:id', requirePermission(P.CONSENT_CAPTURE, P.CONSENT_TEMPLATES), getConsentRecord);

export default router;
