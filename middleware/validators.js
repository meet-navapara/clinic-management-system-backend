import { body, param, validationResult } from 'express-validator';
import { normalizeIndianMobile, isValidEmail, normalizeEmail } from '../utils/normalizeContact.js';

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

const phoneField = (field, { required = true } = {}) => {
  const chain = body(field).trim();
  if (required) {
    chain.notEmpty().withMessage('Mobile number is required');
  } else {
    chain.optional({ values: 'falsy' });
  }
  return chain.custom((value) => {
    if (!required && !value) return true;
    if (!normalizeIndianMobile(value)) {
      throw new Error('Mobile number must be a valid 10-digit Indian number (+91).');
    }
    return true;
  }).customSanitizer((value) => {
    if (!value) return value;
    return normalizeIndianMobile(value) || value;
  });
};

const optionalEmailField = (field = 'email') =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .custom((value) => {
      if (!isValidEmail(value)) throw new Error('Email address is invalid.');
      return true;
    })
    .customSanitizer((value) => normalizeEmail(value));

const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say', ''];

const STRONG_PASSWORD_MESSAGE =
  'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character.';

function meetsPasswordComplexity(password) {
  const value = String(password || '');
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

export const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 120 }).withMessage('Name is too long'),
  body('email').isEmail().withMessage('Valid email is required').customSanitizer((v) => normalizeEmail(v)),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  phoneField('phone'),
];

export const clinicAdminRegisterValidation = [
  ...registerValidation,
  body('setupKey').trim().notEmpty().withMessage('Admin setup key is required'),
];

export const doctorRegisterValidation = [
  ...registerValidation,
  body('setupKey').optional().trim(),
  body('clinicId').optional().isMongoId().withMessage('Valid clinic is required'),
  body('clinicName')
    .optional({ values: 'falsy' })
    .trim()
    .custom((value, { req }) => {
      if (!req.body.clinicId && !String(value || '').trim()) {
        throw new Error('Practice / clinic name is required');
      }
      return true;
    }),
  body('specialization').optional().trim(),
  body('password').custom((value) => {
    if (!value || String(value).length < 6) return true;
    if (!meetsPasswordComplexity(value)) {
      throw new Error(STRONG_PASSWORD_MESSAGE);
    }
    return true;
  }),
  body('confirmPassword')
    .notEmpty()
    .withMessage('Confirm password is required')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
  body('qualification').trim().notEmpty().withMessage('Qualification is required'),
  body('licenseNumber').trim().notEmpty().withMessage('License number is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('experience').optional().isInt({ min: 0 }).withMessage('Experience must be 0 or more'),
  body('consultationFee').optional().isInt({ min: 0 }).withMessage('Fee must be 0 or more'),
  body('bio').optional().trim(),
];

export const receptionistRegisterValidation = [
  ...registerValidation,
  body('clinicId').optional().isMongoId().withMessage('Valid clinic is required'),
];

export const loginValidation = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Valid email is required')
    .customSanitizer((v) => normalizeEmail(v)),
  body('password').notEmpty().withMessage('Password is required'),
  body('role')
    .optional()
    .isIn(['super_admin', 'clinic_admin', 'doctor'])
    .withMessage('Invalid role'),
];

export const appointmentValidation = [
  body('patientId').notEmpty().withMessage('Patient ID is required').isMongoId().withMessage('Valid patient is required'),
  body('appointmentDate').isISO8601().withMessage('Valid appointment date is required'),
  body('timeSlot').trim().notEmpty().withMessage('Time slot is required'),
  body('reason').trim().notEmpty().withMessage('Reason for visit is required').isLength({ max: 500 }).withMessage('Reason is too long'),
  body('doctorId').optional().isMongoId().withMessage('Valid doctor ID is required'),
  body('notes').optional().trim().isLength({ max: 2000 }).withMessage('Notes are too long'),
];

export const patientCreateValidation = [
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 80 }),
  body('middleName').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 80 }),
  body('name').optional({ values: 'falsy' }).trim().isLength({ max: 160 }).withMessage('Name is too long'),
  phoneField('phone'),
  optionalEmailField('email'),
  body('gender').trim().notEmpty().withMessage('Gender is required').isIn(['male', 'female', 'other', 'prefer_not_to_say']).withMessage('Invalid gender'),
  body('dateOfBirth')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Date of birth is invalid')
    .custom((value) => {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new Error('Date of birth is invalid');
      if (d > new Date()) throw new Error('Date of birth cannot be in the future');
      if (d.getFullYear() < 1900) throw new Error('Date of birth is too far in the past');
      return true;
    }),
  body('age').optional({ values: 'falsy' }).isInt({ min: 0, max: 150 }).withMessage('Age must be between 0 and 150'),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Address is too long'),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('area').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('bloodGroup')
    .optional({ values: 'falsy' })
    .isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'])
    .withMessage('Invalid blood group'),
  body('aadharNumber')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{12}$/)
    .withMessage('Aadhar number must be 12 digits'),
  body('doctorId').optional().isMongoId().withMessage('Valid doctor is required'),
  body('secondaryPhone')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (!value) return true;
      if (!normalizeIndianMobile(value)) {
        throw new Error('Secondary number must be a valid 10-digit Indian number (+91).');
      }
      return true;
    })
    .customSanitizer((value) => (value ? normalizeIndianMobile(value) : value)),
  body('emergencyContactPhone')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (!value) return true;
      if (!normalizeIndianMobile(value)) {
        throw new Error('Relative contact must be a valid 10-digit Indian number (+91).');
      }
      return true;
    })
    .customSanitizer((value) => (value ? normalizeIndianMobile(value) : value)),
];

export const patientUpdateValidation = [
  body('firstName').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('lastName').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('name').optional({ values: 'falsy' }).trim().isLength({ max: 160 }),
  body('phone')
    .optional()
    .trim()
    .custom((value) => {
      if (value === undefined || value === null || value === '') return true;
      if (!normalizeIndianMobile(value)) {
        throw new Error('Mobile number must be a valid 10-digit Indian number (+91).');
      }
      return true;
    })
    .customSanitizer((value) => {
      if (!value) return value;
      return normalizeIndianMobile(value) || value;
    }),
  optionalEmailField('email'),
  body('gender').optional({ values: 'falsy' }).isIn(GENDERS.filter(Boolean)).withMessage('Invalid gender'),
  body('dateOfBirth')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Date of birth is invalid')
    .custom((value) => {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new Error('Date of birth is invalid');
      if (d > new Date()) throw new Error('Date of birth cannot be in the future');
      if (d.getFullYear() < 1900) throw new Error('Date of birth is too far in the past');
      return true;
    }),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  body('emergencyContactPhone')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (!value) return true;
      if (!normalizeIndianMobile(value)) {
        throw new Error('Emergency contact phone must be a valid 10-digit Indian number (+91).');
      }
      return true;
    })
    .customSanitizer((value) => (value ? normalizeIndianMobile(value) : value)),
  param('id').isMongoId().withMessage('Valid patient id is required'),
];

export const staffCreateValidation = [
  body('name').trim().notEmpty().withMessage('Full name is required').isLength({ max: 120 }).withMessage('Name is too long'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .customSanitizer((v) => normalizeEmail(v)),
  phoneField('phone'),
  body('staffType').trim().notEmpty().withMessage('Staff type is required'),
  body('role').optional().trim(),
  body('loginEnabled').optional().toBoolean(),
  body('branchIds').custom((value, { req }) => {
    const type = String(req.body.staffType || req.body.role || '').trim();
    if (type === 'doctor') return true;
    const ids = Array.isArray(value) ? value.filter(Boolean) : [];
    if (!ids.length && !req.body.defaultBranchId) {
      throw new Error('Branch is required.');
    }
    return true;
  }),
  body('password').custom((value, { req }) => {
    const type = String(req.body.staffType || req.body.role || '').trim();
    const isDoctor = type === 'doctor';
    const enableLogin = isDoctor ? true : Boolean(req.body.loginEnabled);
    if (enableLogin && !value) {
      throw new Error('Password is required.');
    }
    if (!value) return true;
    if (String(value).length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    if (!meetsPasswordComplexity(value)) {
      throw new Error(STRONG_PASSWORD_MESSAGE);
    }
    return true;
  }),
];

export const paymentValidation = [
  body('amount').notEmpty().withMessage('Amount is required').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('paymentMethod').optional().trim().isLength({ max: 40 }),
  body('notes').optional().trim().isLength({ max: 500 }),
];

export const branchCreateValidation = [
  body('name').trim().notEmpty().withMessage('Branch name is required').isLength({ max: 120 }),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  optionalEmailField('email'),
  phoneField('phone', { required: false }),
];

export const ratingValidation = [
  body('doctorId').notEmpty().withMessage('Doctor ID is required'),
  body('score').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().trim().isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
];
