import rateLimit from 'express-rate-limit';

const jsonMessage = (message) => ({
  success: false,
  message,
});

/** Strict limiter for login / signup / setup */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many auth attempts. Please try again later.'),
});

/** Slightly stricter on password login specifically */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many login attempts. Please try again later.'),
});

/** Light general API ceiling — avoids breaking normal clinic usage */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many requests. Please try again later.'),
});
