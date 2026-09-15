import { Router } from 'express';
import { msg91Webhook, resendWebhook } from '../controllers/commsWebhookController.js';

const router = Router();

// Public provider callbacks — authenticated via shared secret, not JWT
router.post('/msg91', msg91Webhook);
router.post('/resend', resendWebhook);

export default router;
