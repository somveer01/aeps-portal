'use strict';

const bcrypt = require('bcryptjs');
const repo = require('../repositories/usersManager.repo');
const userTypeRepo = require('../repositories/userType.repo');
const planRepo = require('../repositories/plan.repo');
const settingsRepo = require('../repositories/settings.repo');
const audit = require('../repositories/audit.repo');
const db = require('../config/db');

const clean = (v) => String(v || '').trim();
const KYC = ['pending', 'verified', 'rejected'];
const GENDER = ['male', 'female', 'other'];
const intOrNull = (v) => (v ? parseInt(v, 10) : null);
const arr = (v) => (Array.isArray(v) ? v : []);

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({
      q: clean(req.query.q),
      userTypeId: req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null,
      kycStatus: KYC.includes(req.query.kycStatus) ? req.query.kycStatus : '',
      accountStatus: ['active', 'inactive'].includes(req.query.accountStatus) ? req.query.accountStatus : '',
      parentUser: clean(req.query.parentUser),
      page, pageSize,
    });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

// GET /api/module-options -> Modules submenu (for Employee Module Access)
async function moduleOptions(req, res, next) {
  try {
    const modulesParent = await db('menu_items').where({ title: 'Modules' }).whereNull('parent_id').first();
    const rows = modulesParent
      ? await db('menu_items').where({ parent_id: modulesParent.id, is_active: true }).orderBy('sort_order').select('id', 'title', 'route')
      : [];
    return res.json({ modules: rows });
  } catch (err) { return next(err); }
}

// Insert a managed user with a generated user_code, retrying on a unique-code
// collision (e.g. two concurrent creates racing for the same sequence number).
async function createUserWithCode(buildRow) {
  const prefix = (await settingsRepo.get('user_id_prefix')) || 'AEPC';
  let seq = (await repo.countManaged()) + 1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = `${prefix}${String(seq).padStart(4, '0')}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      return await repo.create(buildRow(code));
    } catch (err) {
      if (err.code === '23505') { seq += 1; continue; } // code taken (race) → next
      throw err;
    }
  }
  throw Object.assign(new Error('Could not allocate a unique user code'), { status: 409 });
}

// Shared field mapping from request body -> db columns (for create & update).
function mapFields(b) {
  const out = {};
  if (b.name !== undefined) out.full_name = clean(b.name);
  if (b.shopName !== undefined) out.shop_name = clean(b.shopName) || null;
  if (b.fatherHusbandName !== undefined) out.father_husband_name = clean(b.fatherHusbandName) || null;
  if (b.dob !== undefined) out.dob = clean(b.dob) || null;
  if (b.mobile !== undefined) out.mobile = clean(b.mobile);
  if (b.email !== undefined) out.email = clean(b.email);
  if (b.panNumber !== undefined) out.pan_number = clean(b.panNumber).toUpperCase() || null;
  if (b.aadharNumber !== undefined) out.aadhar_number = clean(b.aadharNumber) || null;
  if (b.gender !== undefined) out.gender = GENDER.includes(String(b.gender).toLowerCase()) ? String(b.gender).toLowerCase() : null;
  if (b.gstNumber !== undefined) out.gst_number = clean(b.gstNumber) || null;
  if (b.minBalance !== undefined) out.min_balance = Number(b.minBalance) || 0;
  if (b.userTypeId !== undefined) out.user_type_id = intOrNull(b.userTypeId);
  if (b.planId !== undefined) out.plan_id = intOrNull(b.planId);
  if (b.parentId !== undefined) out.parent_id = intOrNull(b.parentId);
  if (b.address !== undefined) out.address = clean(b.address) || null;
  if (b.stateId !== undefined) out.state_id = intOrNull(b.stateId);
  if (b.cityId !== undefined) out.city_id = intOrNull(b.cityId);
  if (b.pincode !== undefined) out.pincode = clean(b.pincode) || null;
  if (b.merchantId !== undefined) out.merchant_id = clean(b.merchantId) || null;
  if (b.assignedEmployeeId !== undefined) out.assigned_employee_id = intOrNull(b.assignedEmployeeId);
  if (b.serviceAccess !== undefined) out.service_access = arr(b.serviceAccess);
  if (b.moduleAccess !== undefined) out.module_access = arr(b.moduleAccess);
  if (b.kycStatus !== undefined && KYC.includes(b.kycStatus)) out.kyc_status = b.kycStatus;
  if (b.ekycStatus !== undefined && KYC.includes(b.ekycStatus)) out.ekyc_status = b.ekycStatus;
  if (b.isActive !== undefined) out.is_active = !!b.isActive;
  return out;
}

// A parent (upline) must be an existing managed user and cannot be the user itself.
async function checkParent(parentId, selfId) {
  if (!parentId) return null;
  if (selfId && parentId === selfId) return { error: 'A user cannot be their own parent', code: 'INVALID_PARENT' };
  let cur = await repo.findFull(parentId);
  if (!cur) return { error: 'Parent user not found', code: 'INVALID_PARENT' };
  // Walk up the chain so a user can never become their own ancestor.
  for (let i = 0; selfId && cur && cur.parent_id && i < 50; i += 1) {
    if (cur.parent_id === selfId) return { error: 'This parent is already below the user in the chain', code: 'PARENT_CYCLE' };
    // eslint-disable-next-line no-await-in-loop
    cur = await repo.findFull(cur.parent_id);
  }
  return null;
}

async function create(req, res, next) {
  try {
    const b = req.body;
    if (clean(b.name).length < 2) return res.status(400).json({ error: 'Name is required', code: 'INVALID_NAME' });
    if (!/^\d{10}$/.test(clean(b.mobile))) return res.status(400).json({ error: 'Mobile must be 10 digits', code: 'INVALID_MOBILE' });
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(b.email))) return res.status(400).json({ error: 'Enter a valid email', code: 'INVALID_EMAIL' });
    const userTypeId = intOrNull(b.userTypeId);
    if (!userTypeId || !(await userTypeRepo.findById(userTypeId))) return res.status(400).json({ error: 'Please select a valid account type', code: 'INVALID_USER_TYPE' });
    if (b.planId && !(await planRepo.findById(intOrNull(b.planId)))) return res.status(400).json({ error: 'Invalid plan', code: 'INVALID_PLAN' });
    if (String(b.password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters', code: 'WEAK_PASSWORD' });

    const parentErr = await checkParent(intOrNull(b.parentId), null);
    if (parentErr) return res.status(400).json(parentErr);

    const passwordHash = await bcrypt.hash(String(b.password), 12);
    const fields = mapFields(b);
    const id = await createUserWithCode((code) => ({
      username: code, user_code: code, password_hash: passwordHash, role: 'user',
      wallet_balance: 0, kyc_status: 'pending', ekyc_status: 'pending',
      ...fields,
      created_by: req.user.id, // who created this user; never taken from the request body
    }));
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'user_created', detail: { newUserId: id, parentId: fields.parent_id || null }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.status(201).json({ row: await repo.findFull(id) });
  } catch (err) { return next(err); }
}

async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findFull(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const b = req.body;
    if (b.mobile !== undefined && !/^\d{10}$/.test(clean(b.mobile))) return res.status(400).json({ error: 'Mobile must be 10 digits', code: 'INVALID_MOBILE' });
    if (b.userTypeId !== undefined && !(await userTypeRepo.findById(intOrNull(b.userTypeId)))) return res.status(400).json({ error: 'Invalid account type', code: 'INVALID_USER_TYPE' });
    if (b.parentId !== undefined) {
      const parentErr = await checkParent(intOrNull(b.parentId), id);
      if (parentErr) return res.status(400).json(parentErr);
    }
    await repo.update(id, mapFields(b));
    return res.json({ row: await repo.findFull(id) });
  } catch (err) { return next(err); }
}

// POST /api/users/:id/fund  { amount, type: 'credit'|'debit', remark }
async function fund(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const user = await repo.findFull(id);
    if (!user) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount', code: 'INVALID_AMOUNT' });
    const delta = req.body.type === 'debit' ? -amount : amount;
    const ok = await repo.adjustWalletGuarded(id, delta); // atomic; refuses overdraw
    if (!ok) return res.status(400).json({ error: 'Insufficient wallet balance', code: 'INSUFFICIENT' });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'user_wallet_fund', detail: { targetUserId: id, amount, type: delta < 0 ? 'debit' : 'credit' }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.json({ row: await repo.findFull(id) });
  } catch (err) { return next(err); }
}

async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findFull(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    await db('users').where({ id }).del();
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

module.exports = { list, create, update, fund, remove, moduleOptions, createUserWithCode, mapFields };
