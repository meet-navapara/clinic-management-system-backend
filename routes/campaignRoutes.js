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
} from '../controllers/campaignController.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/', requirePermission(P.CAMPAIGNS_MANAGE), listCampaigns);
router.post('/', requirePermission(P.CAMPAIGNS_MANAGE), createCampaign);
router.get('/:id', requirePermission(P.CAMPAIGNS_MANAGE), getCampaign);
router.patch('/:id', requirePermission(P.CAMPAIGNS_MANAGE), updateCampaign);
router.post('/:id/preview', requirePermission(P.CAMPAIGNS_MANAGE), previewCampaign);
router.post('/:id/send', requirePermission(P.CAMPAIGNS_MANAGE), sendCampaign);
router.post('/:id/cancel', requirePermission(P.CAMPAIGNS_MANAGE), cancelCampaign);

export default router;
