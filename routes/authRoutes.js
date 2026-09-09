import { Router } from 'express';
import {
  register,
  registerDoctor,
  registerClinicAdmin,
  registerReceptionist,
  getSetupStatus,
  login,
  getMe,
  updateProfile,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { uploadProfilePhoto } from '../middleware/uploadProfilePhoto.js';
import {
  registerValidation,
  doctorRegisterValidation,
  clinicAdminRegisterValidation,
  receptionistRegisterValidation,
  loginValidation,
  handleValidation,
} from '../middleware/validators.js';

const router = Router();

router.get('/setup-status', getSetupStatus);
router.post('/register', registerValidation, handleValidation, register);
router.post(
  '/register/clinic-admin',
  clinicAdminRegisterValidation,
  handleValidation,
  registerClinicAdmin
);
router.post('/register/doctor', doctorRegisterValidation, handleValidation, registerDoctor);
router.post(
  '/register/receptionist',
  receptionistRegisterValidation,
  handleValidation,
  registerReceptionist
);
router.post('/login', loginValidation, handleValidation, login);
router.get('/me', protect, getMe);
router.put('/profile', protect, (req, res, next) => {
  uploadProfilePhoto(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, updateProfile);

export default router;
