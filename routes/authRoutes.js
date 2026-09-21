import { Router } from 'express';
import {
  register,
  registerDoctor,
  registerClinicAdmin,
  registerReceptionist,
  getSetupStatus,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
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
  emailOtpSendValidation,
  emailOtpVerifyValidation,
} from '../middleware/validators.js';
import { authLimiter, loginLimiter, passwordResetLimiter, emailOtpLimiter } from '../middleware/rateLimit.js';
import { sendSignupEmailOtp, verifySignupEmailOtp } from '../controllers/emailOtpController.js';

const router = Router();

router.get('/setup-status', getSetupStatus);
router.post(
  '/email-otp/send',
  emailOtpLimiter,
  emailOtpSendValidation,
  handleValidation,
  sendSignupEmailOtp
);
router.post(
  '/email-otp/verify',
  emailOtpLimiter,
  emailOtpVerifyValidation,
  handleValidation,
  verifySignupEmailOtp
);
router.post('/register', authLimiter, registerValidation, handleValidation, register);
router.post(
  '/register/clinic-admin',
  authLimiter,
  clinicAdminRegisterValidation,
  handleValidation,
  registerClinicAdmin
);
router.post(
  '/register/doctor',
  authLimiter,
  doctorRegisterValidation,
  handleValidation,
  registerDoctor
);
router.post(
  '/register/receptionist',
  authLimiter,
  receptionistRegisterValidation,
  handleValidation,
  registerReceptionist
);
router.post('/login', loginLimiter, loginValidation, handleValidation, login);
router.post('/logout', logout);
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPassword);
router.get('/me', protect, getMe);
router.put('/profile', protect, (req, res, next) => {
  uploadProfilePhoto(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, updateProfile);
router.put('/change-password', protect, changePassword);

export default router;
