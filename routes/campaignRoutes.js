import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  previewCampaign,
  sendCampaign,
  cancelCampaign,
  testCampaign,
  retryFailed,
  duplicateCampaign,
  getIntegrationsStatus,
} from '../controllers/campaignController.js';
import { campaignSendLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/integrations/status', protect, requireClinicUser, requirePermission(P.CAMPAIGNS_MANAGE), getIntegrationsStatus);

router.use(protect, requireClinicUser, attachBranchContext);

router.get('/', requirePermission(P.CAMPAIGNS_MANAGE), listCampaigns);
router.post('/', requirePermission(P.CAMPAIGNS_MANAGE), createCampaign);
router.get('/:id', requirePermission(P.CAMPAIGNS_MANAGE), getCampaign);
router.patch('/:id', requirePermission(P.CAMPAIGNS_MANAGE), updateCampaign);
router.post('/:id/preview', requirePermission(P.CAMPAIGNS_MANAGE), previewCampaign);
router.post('/:id/send', requirePermission(P.CAMPAIGNS_MANAGE), campaignSendLimiter, sendCampaign);
router.post('/:id/test', requirePermission(P.CAMPAIGNS_MANAGE), campaignSendLimiter, testCampaign);
router.post('/:id/cancel', requirePermission(P.CAMPAIGNS_MANAGE), cancelCampaign);
router.post('/:id/retry-failed', requirePermission(P.CAMPAIGNS_MANAGE), campaignSendLimiter, retryFailed);
router.post('/:id/duplicate', requirePermission(P.CAMPAIGNS_MANAGE), duplicateCampaign);

export default router;
