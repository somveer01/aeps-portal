'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Throttles auth endpoints to blunt brute-force attempts. This is a
 * per-IP guard that complements the per-user daily OTP limit enforced
 * in otp.service.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // requests per IP per window across auth routes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.',
});

module.exports = { authLimiter };
