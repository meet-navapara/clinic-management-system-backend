import { body, validationResult } from 'express-validator';

export const handleValidation = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const errors = result.array();
  const fieldErrors = errors.reduce((acc, err) => {
    const field = err.path || err.param;
    if (field && !acc[field]) acc[field] = err.msg;
    return acc;
  }, {});

  return res.status(422).json({
    success: false,
    message: errors[0].msg,
    errors: fieldErrors,
  });
};

export const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
];

export const doctorRegisterValidation = [
  ...registerValidation,
  body('setupKey').trim().notEmpty().withMessage('Admin setup key is required'),
  body('specialization').optional().trim(),
  body('experience').optional().isInt({ min: 0 }).withMessage('Experience must be 0 or more'),
  body('consultationFee').optional().isInt({ min: 0 }).withMessage('Fee must be 0 or more'),
  body('bio').optional().trim(),
];

export const loginValidation = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

export const appointmentValidation = [
  body('doctorId').notEmpty().withMessage('Doctor ID is required'),
  body('appointmentDate').isISO8601().withMessage('Valid appointment date is required'),
  body('timeSlot').trim().notEmpty().withMessage('Time slot is required'),
  body('reason').trim().notEmpty().withMessage('Reason for visit is required'),
];

export const ratingValidation = [
  body('doctorId').notEmpty().withMessage('Doctor ID is required'),
  body('score').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().trim().isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
];
