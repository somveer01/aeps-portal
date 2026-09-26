'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * JWT helpers. Two token kinds:
 *  - "pending": short-lived, issued after password+captcha, only valid to
 *    complete OTP verification. stage='otp'.
 *  - "access":  issued after successful OTP, authenticates API requests.
 *    stage='access'.
 */

function signPending(userId) {
  return jwt.sign({ sub: userId, stage: 'otp' }, env.jwt.secret, {
    expiresIn: env.jwt.pendingTtl,
  });
}

function signAccess(user) {
  return jwt.sign(
    { sub: user.id, stage: 'access', username: user.username, role: user.role, epoch: user.token_epoch || 0 },
    env.jwt.secret,
    { expiresIn: env.jwt.accessTtl },
  );
}

function verify(token) {
  return jwt.verify(token, env.jwt.secret);
}

module.exports = { signPending, signAccess, verify };
