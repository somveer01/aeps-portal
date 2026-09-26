'use strict';

const bcrypt = require('bcryptjs');
const env = require('../config/env');
const userRepo = require('../repositories/user.repo');
const auditRepo = require('../repositories/audit.repo');
const otpService = require('../services/otp.service');
const captchaService = require('../services/captcha.service');
const tokenService = require('../services/token.service');
const menuService = require('../services/menu.service');

function maskMobile(mobile) {
  const s = String(mobile || '');
  if (s.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

function clientMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

// GET /api/auth/captcha -> { captchaId, svg }
function getCaptcha(req, res) {
  const { captchaId, svg } = captchaService.generate();
  res.json({ captchaId, svg });
}

// POST /api/auth/login  { username, password, captchaId, captcha }
async function login(req, res, next) {
  try {
    const { username = '', password = '', captchaId = '', captcha = '' } = req.body;
    const uname = String(username).trim();
    const meta = clientMeta(req);

    if (!captchaService.verify(captchaId, captcha)) {
      await auditRepo.log({ username: uname, event: 'login_captcha_failed', ...meta });
      return res.status(400).json({ error: 'Incorrect captcha', code: 'BAD_CAPTCHA' });
    }

    const user = await userRepo.findActiveByUsername(uname);

    // Account lockout check (before password compare).
    if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      await auditRepo.log({ userId: user.id, username: uname, event: 'login_blocked_locked', ...meta });
      return res.status(423).json({
        error: `Account locked due to too many failed attempts. Try again in ${mins} minute(s).`,
        code: 'ACCOUNT_LOCKED',
      });
    }

    const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !passwordOk) {
      // Count the failure and lock the account if the threshold is reached.
      if (user) {
        const count = await userRepo.incrementFailedAttempts(user.id);
        if (count >= env.login.maxFailed) {
          const until = new Date(Date.now() + env.login.lockoutMinutes * 60000);
          await userRepo.lockUntil(user.id, until);
          await auditRepo.log({ userId: user.id, username: uname, event: 'account_locked', detail: { count }, ...meta });
        } else {
          await auditRepo.log({ userId: user.id, username: uname, event: 'login_failed', detail: { count }, ...meta });
        }
      } else {
        await auditRepo.log({ username: uname, event: 'login_failed_unknown_user', ...meta });
      }
      return res.status(401).json({ error: 'Invalid username or password', code: 'BAD_CREDENTIALS' });
    }

    // Password correct — clear any failed-attempt state.
    await userRepo.resetLoginState(user.id);

    const result = await otpService.issueOtp(user, 'login');
    if (!result.ok) {
      if (result.reason === 'daily_limit') {
        return res.status(429).json({
          error: `Daily OTP limit reached (${env.otp.dailyLimit}). Try again tomorrow.`,
          code: 'OTP_DAILY_LIMIT',
        });
      }
      return res.status(500).json({ error: 'Could not send OTP', code: 'OTP_SEND_FAILED' });
    }

    await auditRepo.log({ userId: user.id, username: uname, event: 'login_password_ok_otp_sent', ...meta });
    return res.json({
      pendingToken: tokenService.signPending(user.id),
      mobileMask: maskMobile(user.mobile),
      otpTtlMinutes: Math.round(env.otp.ttlSeconds / 60),
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/auth/verify-otp  { pendingToken, otp }
async function verifyOtp(req, res, next) {
  try {
    const { otp = '' } = req.body;
    const userId = req.pendingUserId;

    const meta = clientMeta(req);
    const result = await otpService.verifyOtp(userId, String(otp).trim(), 'login');
    if (!result.ok) {
      const map = {
        no_otp: ['No active OTP found. Please log in again.', 401],
        expired: ['OTP has expired. Please request a new one.', 401],
        too_many_attempts: ['Too many incorrect attempts. Please log in again.', 429],
        mismatch: ['Incorrect OTP', 401],
      };
      const [msg, status] = map[result.reason] || ['OTP verification failed', 400];
      await auditRepo.log({ userId, event: 'otp_failed', detail: { reason: result.reason }, ...meta });
      return res.status(status).json({ error: msg, code: result.reason.toUpperCase() });
    }

    const user = await userRepo.findById(userId);
    await auditRepo.log({ userId, username: user.username, event: 'login_success', ...meta });
    return res.json({
      accessToken: tokenService.signAccess(user),
      user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role },
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/auth/resend-otp  { pendingToken }
async function resendOtp(req, res, next) {
  try {
    const user = await userRepo.findById(req.pendingUserId);
    if (!user) return res.status(401).json({ error: 'Please log in again', code: 'NO_USER' });

    const result = await otpService.issueOtp(user, 'login');
    if (!result.ok) {
      const msg =
        result.reason === 'daily_limit'
          ? `Daily OTP limit reached (${env.otp.dailyLimit}). Try again tomorrow.`
          : 'Could not resend OTP';
      return res.status(429).json({ error: msg, code: 'OTP_RESEND_FAILED' });
    }
    return res.json({ ok: true, otpTtlMinutes: Math.round(env.otp.ttlSeconds / 60) });
  } catch (err) {
    return next(err);
  }
}

// GET /api/me
async function me(req, res, next) {
  try {
    const user = await userRepo.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({
      user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role, mobile: user.mobile },
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/menu -> dynamic menu tree (scoped to the caller's role)
async function menu(req, res, next) {
  try {
    // Managed users (retailers) get the retailer sidebar; admin gets the admin one.
    const scopes = req.user && req.user.userTypeId ? ['retailer', 'both'] : ['admin', 'both'];
    return res.json({ menu: await menuService.getMenuTree(scopes) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getCaptcha, login, verifyOtp, resendOtp, me, menu };
