import { Router } from 'express';
import {
  createRating,
  getMyRatingForDoctor,
  getDoctorRatings,
} from '../controllers/ratingController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ratingValidation } from '../middleware/validators.js';

const router = Router();

router.get('/doctor/:doctorId', getDoctorRatings);
router.get('/mine/:doctorId', protect, authorize('patient'), getMyRatingForDoctor);
router.post('/', protect, authorize('patient'), ratingValidation, createRating);

export default router;
