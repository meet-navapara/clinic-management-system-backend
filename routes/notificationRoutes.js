import { Router } from 'express';
import {
  listMyNotifications,
  runReminderPass,
  listDoctorInbox,
  markInboxRead,
  markAllInboxRead,
} from '../controllers/notificationController.js';
import { protect, authorize, requireApprovedDoctor } from '../middleware/auth.js';
import { attachBranchContext } from '../middleware/access.js';

const router = Router();

router.use(protect);

router.get('/inbox', authorize('doctor'), requireApprovedDoctor, listDoctorInbox);
router.patch('/inbox/read-all', authorize('doctor'), requireApprovedDoctor, markAllInboxRead);
router.patch('/inbox/:id/read', authorize('doctor'), requireApprovedDoctor, markInboxRead);

router.get('/', authorize('doctor'), requireApprovedDoctor, attachBranchContext, listMyNotifications);
router.post(
  '/process-due',
  authorize('doctor'),
  runReminderPass
);

export default router;
