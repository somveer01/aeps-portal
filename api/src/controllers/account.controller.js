'use strict';

const bcrypt = require('bcryptjs');
const db = require('../config/db');
const userRepo = require('../repositories/user.repo');
const audit = require('../repositories/audit.repo');
const { ValidationError } = require('../utils/validate');
const { nameFields, prepareName } = require('./usersManager.controller');

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

// The signed-in user's own profile (admin or managed user). Mobile, PAN, Aadhaar, shop and type are shown, never edited here.
async function loadProfile(userId) {
  const u = await db('users as u')
    .leftJoin('user_types as ut', 'ut.id', 'u.user_type_id')
    .leftJoin('users as par', 'par.id', 'u.parent_id')
    .where('u.id', userId)
    .first('u.id', 'u.username', 'u.user_code', 'u.role', 'u.full_name', 'u.first_name', 'u.middle_name', 'u.last_name', 'u.email', 'u.mobile', 'u.photo',
      'u.shop_name', 'u.kyc_status', 'u.wallet_balance', 'u.last_login_at', 'u.txn_pin_hash', 'ut.name as user_type_name', 'par.user_code as parent_code');
  if (!u) return null;
  return {
    id: u.id, username: u.username, userCode: u.user_code || u.username, role: u.role,
    fullName: u.full_name, firstName: u.first_name || '', middleName: u.middle_name || '', lastName: u.last_name || '',
    email: u.email || '', mobile: u.mobile || '', photo: u.photo || null,
    userTypeName: u.user_type_name || (u.role === 'admin' ? 'Admin' : ''), shopName: u.shop_name || '', kycStatus: u.role === 'admin' ? null : u.kyc_status,
    parentCode: u.parent_code || '', balance: Number(u.wallet_balance || 0), lastLoginAt: u.last_login_at, hasTxnPin: !!u.txn_pin_hash,
  };
}

// GET /api/account/profile
async function getProfile(req, res, next) {
  try {
    const profile = await loadProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    return res.json({ profile });
  } catch (err) { return next(err); }
}

// PUT /api/account/profile { firstName, middleName, lastName, email, photo, currentPassword }
// Only what is sent changes. A name part left out keeps its saved value, photo '' removes the photo,
// and changing the email needs the current password (the email is a recovery / contact address).
async function updateProfile(req, res, next) {
  try {
    const b = req.body || {};
    const existing = await db('users').where({ id: req.user.id }).first('full_name', 'first_name', 'middle_name', 'last_name', 'email', 'password_hash', 'role', 'kyc_status');
    if (!existing) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    const patch = {}; const changed = [];

    if (['firstName', 'middleName', 'lastName'].some((k) => b[k] !== undefined)) {
      const named = prepareName({ firstName: b.firstName, middleName: b.middleName, lastName: b.lastName }, { ...existing, name: existing.full_name });
      if (named.error) return res.status(400).json(named.error);
      const fields = nameFields(named.body);
      if (fields.full_name !== existing.full_name) {
        // The name of a KYC-verified user is what was verified: only the admin can change it (Users Manager).
        if (existing.role !== 'admin' && existing.kyc_status === 'verified') {
          return res.status(403).json({ error: 'Your name is verified by KYC. Contact the admin to change it.', code: 'NAME_LOCKED' });
        }
        Object.assign(patch, fields);
        changed.push('name');
      }
    }
    if (b.email !== undefined) {
      const email = String(b.email || '').trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email', code: 'INVALID_EMAIL' });
      if (email.length > 150) return res.status(400).json({ error: 'Email is too long', code: 'INVALID_EMAIL' });
      if (email !== (existing.email || '')) {
        const ok = await bcrypt.compare(String(b.currentPassword || ''), existing.password_hash);
        if (!ok) return res.status(401).json({ error: 'Enter your current password to change the email', code: 'BAD_CURRENT' });
        patch.email = email || null;
        changed.push('email');
      }
    }
    if (b.photo !== undefined) {
      const photo = String(b.photo || '').trim();
      if (photo && !(/^\/uploads\/[\w.-]+$/.test(photo) && photo.length <= 255)) return res.status(400).json({ error: 'Upload the photo from this screen', code: 'INVALID_PHOTO' });
      patch.photo = photo || null;
      changed.push('photo');
    }

    if (Object.keys(patch).length) {
      await db('users').where({ id: req.user.id }).update({ ...patch, updated_at: db.fn.now() });
      await audit.log({ userId: req.user.id, username: req.user.username, event: 'profile_updated', detail: { fields: changed }, ...meta(req) });
    }
    return res.json({ profile: await loadProfile(req.user.id) });
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

module.exports = { changePassword, getProfile, updateProfile, logout, setTxnPin };
