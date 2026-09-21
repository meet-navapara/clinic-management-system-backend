import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const jsonMessage = (message) => ({
  success: false,
  message,
});

/**
 * Shared options so rate-limit never crashes when req.ip is missing
 * (local/proxy edge cases → ERR_ERL_UNDEFINED_IP_ADDRESS),
 * and uses ipKeyGenerator for correct IPv6 handling.
 */
const safeDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
    ip: false,
  },
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const fromHeader =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : Array.isArray(forwarded)
          ? forwarded[0]
          : '';
    const ip = req.ip || req.socket?.remoteAddress || fromHeader;
    if (!ip) return 'unknown';
    return ipKeyGenerator(ip);
  },
};

/** Strict limiter for login / signup / setup */
export const authLimiter = rateLimit({
  ...safeDefaults,
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: jsonMessage('Too many auth attempts. Please try again later.'),
});

/** Slightly stricter on password login specifically */
export const loginLimiter = rateLimit({
  ...safeDefaults,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: jsonMessage('Too many login attempts. Please try again later.'),
});

/** Light general API ceiling — avoids breaking normal clinic usage */
export const apiLimiter = rateLimit({
  ...safeDefaults,
  windowMs: 60 * 1000,
  max: 300,
  message: jsonMessage('Too many requests. Please try again later.'),
});

/** Password reset / forgot-password */
export const passwordResetLimiter = rateLimit({
  ...safeDefaults,
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: jsonMessage('Too many password reset attempts. Please try again later.'),
});

/** Email OTP send / verify */
export const emailOtpLimiter = rateLimit({
  ...safeDefaults,
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: jsonMessage('Too many verification attempts. Please try again later.'),
});

/** Campaign send / test / retry — expensive provider calls */
export const campaignSendLimiter = rateLimit({
  ...safeDefaults,
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: jsonMessage('Too many campaign send attempts. Please try again later.'),
});

/** Reminder process-due — prevent accidental global spam */
export const processDueLimiter = rateLimit({
  ...safeDefaults,
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: jsonMessage('Reminder processing is rate limited. Try again shortly.'),
});
