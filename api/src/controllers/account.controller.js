'use strict';

const bcrypt = require('bcryptjs');
const db = require('../config/db');
const userRepo = require('../repositories/user.repo');
const audit = require('../repositories/audit.repo');
const { ValidationError } = require('../utils/validate');

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

// POST /api/account/change-password { currentPassword, newPassword, confirmPassword }
async function changePassword(req, res, next) {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    if (newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters', 'WEAK_PASSWORD');
    if (newPassword !== confirmPassword) throw new ValidationError('New password and confirmation do not match', 'MISMATCH');

    const user = await db('users').where({ id: req.user.id }).first('password_hash');
    const ok = user && await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) throw Object.assign(new ValidationError('Current password is incorrect', 'BAD_CURRENT'), { status: 401 });
    if (currentPassword === newPassword) throw new ValidationError('New password must be different from the current one', 'SAME_PASSWORD');

    const hash = await bcrypt.hash(newPassword, 12);
    await userRepo.setPassword(req.user.id, hash); // also bumps token_epoch -> revokes existing tokens
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'password_changed', ...meta(req) });
    return res.json({ ok: true, reauth: true });
  } catch (err) { return next(err); }
}

// POST /api/account/logout — revoke all access tokens for this user.
async function logout(req, res, next) {
  try {
    await userRepo.bumpTokenEpoch(req.user.id);
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'logout', ...meta(req) });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

// POST /api/account/txn-pin { currentPassword, pin, confirmPin } — set/replace the transaction PIN.
async function setTxnPin(req, res, next) {
  try {
    const pin = String(req.body.pin || '');
    const confirmPin = String(req.body.confirmPin || '');
    if (!/^\d{4,6}$/.test(pin)) throw new ValidationError('PIN must be 4–6 digits', 'INVALID_PIN');
    if (pin !== confirmPin) throw new ValidationError('PIN and confirmation do not match', 'MISMATCH');

    const user = await db('users').where({ id: req.user.id }).first('password_hash');
    const ok = user && await bcrypt.compare(String(req.body.currentPassword || ''), user.password_hash);
    if (!ok) throw Object.assign(new ValidationError('Current password is incorrect', 'BAD_CURRENT'), { status: 401 });

    const hash = await bcrypt.hash(pin, 12);
    await db('users').where({ id: req.user.id }).update({ txn_pin_hash: hash, updated_at: db.fn.now() });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'txn_pin_set', ...meta(req) });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

module.exports = { changePassword, logout, setTxnPin };
