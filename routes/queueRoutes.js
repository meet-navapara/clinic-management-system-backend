import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import { listQueue, checkIn, updateTicketStatus, callNext, displayQueue } from '../controllers/queueController.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/', requirePermission(P.QUEUE_MANAGE), listQueue);
router.get('/display', requirePermission(P.QUEUE_MANAGE), displayQueue);
router.post('/check-in', requirePermission(P.QUEUE_MANAGE), checkIn);
router.post('/call-next', requirePermission(P.QUEUE_MANAGE), callNext);
router.patch('/:id/status', requirePermission(P.QUEUE_MANAGE), updateTicketStatus);

export default router;
