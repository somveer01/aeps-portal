'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const otpRepo = require('../repositories/otp.repo');
const smsService = require('./sms.service');

/** Generate a numeric OTP of the configured length. */
function generateCode() {
  const max = 10 ** env.otp.length;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(env.otp.length, '0');
}

/**
 * Issue an OTP for a user and send it over SMS.
 * Enforces the per-user daily send limit before generating anything.
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function issueOtp(user, purpose = 'login') {
  // Dev master OTP: skip SMS + daily limit entirely so testing never locks out.
  if (env.devMasterOtp && !env.isProd) {
    // eslint-disable-next-line no-console
    console.log(`[DEV OTP] master OTP active — use "${env.devMasterOtp}" (no SMS, daily limit bypassed)`);
    return { ok: true };
  }

  const sentToday = await otpRepo.countSentToday(user.id);
  if (sentToday >= env.otp.dailyLimit) {
    return { ok: false, reason: 'daily_limit' };
  }

  const code = generateCode();
  const otpHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.otp.ttlSeconds * 1000);

  await otpRepo.create({ userId: user.id, otpHash, purpose, expiresAt });
  await smsService.sendOtp(user.mobile, code);

  return { ok: true };
}

/**
 * Verify a user-entered OTP against the latest active one.
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 *   reasons: no_otp | expired | too_many_attempts | mismatch
 */
async function verifyOtp(userId, inputCode, purpose = 'login') {
  // Dev master OTP: accept the fixed code without any DB lookup.
  if (env.devMasterOtp && !env.isProd && String(inputCode || '') === env.devMasterOtp) {
    return { ok: true };
  }

  const record = await otpRepo.findLatestActive(userId, purpose);
  if (!record) return { ok: false, reason: 'no_otp' };

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  if (record.verify_attempts >= env.otp.maxVerifyAttempts) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  const matches = await bcrypt.compare(String(inputCode || ''), record.otp_hash);
  if (!matches) {
    await otpRepo.incrementVerifyAttempts(record.id);
    return { ok: false, reason: 'mismatch' };
  }

  await otpRepo.markConsumed(record.id);
  return { ok: true };
}

module.exports = { issueOtp, verifyOtp };
