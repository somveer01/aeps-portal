'use strict';

const bcrypt = require('bcryptjs');
const userRepo = require('../repositories/user.repo');
const { MIN_PASSWORD, generatePassword } = require('../utils/password');
const { parseGrid } = require('../utils/gridQuery');
const repo = require('../repositories/usersManager.repo');
const userTypeRepo = require('../repositories/userType.repo');
const planRepo = require('../repositories/plan.repo');
const settingsRepo = require('../repositories/settings.repo');
const audit = require('../repositories/audit.repo');
const db = require('../config/db');
const permission = require('../services/servicePermission.service');
const networkRepo = require('../repositories/network.repo');

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
      grid: parseGrid(req.query, repo.USERS_GRID),
      page, pageSize,
    });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

const typeIds = (v) => String(v || '').split(',').map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0);

// GET /api/users/search?q&userTypeId&id&userCode&limit -> a few slim rows for the user picker (admin: every user).
async function search(req, res, next) {
  try {
    const rows = await repo.search({
      q: clean(req.query.q), userTypeIds: typeIds(req.query.userTypeId), // one id or a comma-separated list
      id: req.query.id ? parseInt(req.query.id, 10) || null : null, userCode: clean(req.query.userCode),
      limit: parseInt(req.query.limit, 10) || 20,
    });
    return res.json({ rows });
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

// A user's name is three parts: firstName (required), middleName (optional), lastName (required). users.full_name is
// the parts joined by single spaces and is what every report, search and list shows. An older client may still send
// one `name`; it is split the way the migration split existing users (first word / last word / the rest = middle).
const NAME_PART_MAX = 80;
const NAME_KEYS = ['firstName', 'middleName', 'lastName'];
function splitName(full) {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '', middle: parts.slice(1, -1).join(' ') };
}
function nameParts(b) {
  if (NAME_KEYS.some((k) => b[k] !== undefined)) return { first: clean(b.firstName), middle: clean(b.middleName), last: clean(b.lastName), split: true };
  if (b.name !== undefined) return { ...splitName(b.name), split: false };
  return null;
}
function nameFields(b) {
  const n = nameParts(b);
  if (!n) return {};
  return { first_name: n.first || null, middle_name: n.middle || null, last_name: n.last || null, full_name: [n.first, n.middle, n.last].filter(Boolean).join(' ') };
}
// null when fine. Three-part names need a first and a last name; the old single `name` needs 2 characters.
function nameError(b) {
  const n = nameParts(b);
  if (!n) return { error: 'Name is required', code: 'INVALID_NAME' };
  if ([n.first, n.middle, n.last].some((p) => p.length > NAME_PART_MAX)) return { error: `Each name part can be at most ${NAME_PART_MAX} characters`, code: 'INVALID_NAME' };
  if (n.split) {
    if (!n.first) return { error: 'First name is required', code: 'INVALID_NAME' };
    if (!n.last) return { error: 'Last name is required', code: 'INVALID_NAME' };
    return null;
  }
  return [n.first, n.middle, n.last].filter(Boolean).join(' ').length < 2 ? { error: 'Name is required', code: 'INVALID_NAME' } : null;
}
// For an edit: a part left out of the request keeps its saved value (so sending only lastName never wipes the
// others), then the name is validated. Returns { body, error }.
function prepareName(b, existing) {
  let body = b;
  if (NAME_KEYS.some((k) => b[k] !== undefined)) {
    const hasParts = existing.first_name || existing.middle_name || existing.last_name;
    const s = splitName(existing.name);
    const saved = hasParts
      ? { firstName: existing.first_name, middleName: existing.middle_name, lastName: existing.last_name }
      : { firstName: s.first, middleName: s.middle, lastName: s.last };
    body = { ...b };
    NAME_KEYS.forEach((k) => { if (body[k] === undefined) body[k] = saved[k] || ''; });
  }
  return { body, error: nameParts(body) ? nameError(body) : null };
}

// Shared field mapping from request body -> db columns (for create & update).
function mapFields(b) {
  const out = {};
  Object.assign(out, nameFields(b));
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
  if (b.moduleAccess !== undefined) out.module_access = arr(b.moduleAccess);
  if (b.kycStatus !== undefined && KYC.includes(b.kycStatus)) out.kyc_status = b.kycStatus;
  if (b.ekycStatus !== undefined && KYC.includes(b.ekycStatus)) out.ekyc_status = b.ekycStatus;
  if (b.isActive !== undefined) out.is_active = !!b.isActive;
  return out;
}

// The admin's id: the caller when the admin is acting, else the first admin account.
async function adminIdOf(req) {
  if (req.user.role === 'admin') return req.user.id;
  const admin = await db('users').where({ role: 'admin' }).orderBy('id').first('id');
  return admin ? admin.id : null;
}

// Can a user of `typeId` sit under `parent`? The admin can hold any type; a managed parent only
// the types below its own type in the User Type tree (a Retailer under a Distributor or an SD).
async function checkParentFits(typeId, parent) {
  if (!parent || parent.role === 'admin' || !typeId) return null;
  if (parent.user_type_id && (await networkRepo.isTypeBelow(parent.user_type_id, typeId))) return null;
  const type = await userTypeRepo.findById(typeId);
  const above = (await networkRepo.typesAbove(typeId)).map((t) => t.name);
  return { error: `A ${type ? type.name : 'user'} can be placed under: ${['Admin', ...above].join(', ')}`, code: 'PARENT_TYPE_MISMATCH' };
}

// A parent (upline) must be the admin or a managed user, cannot be the user itself or anyone
// below it, and must be allowed to hold a user of `typeId`.
async function checkParent(parentId, selfId, typeId) {
  if (!parentId) return null;
  if (selfId && parentId === selfId) return { error: 'A user cannot be their own parent', code: 'INVALID_PARENT' };
  const parent = await db('users').where({ id: parentId }).first('id', 'role', 'user_type_id', 'parent_id');
  if (!parent || (parent.role !== 'admin' && !parent.user_type_id)) return { error: 'Parent user not found', code: 'INVALID_PARENT' };
  // Walk up the chain so a user can never become their own ancestor.
  let cur = parent;
  for (let i = 0; selfId && cur && cur.parent_id && i < 50; i += 1) {
    if (cur.parent_id === selfId) return { error: 'This parent is already below the user in the chain', code: 'PARENT_CYCLE' };
    // eslint-disable-next-line no-await-in-loop
    cur = await db('users').where({ id: cur.parent_id }).first('id', 'parent_id');
  }
  return checkParentFits(typeId, parent);
}

// Top-level account types (no Parent Type, e.g. Super Distributor) always sit directly under
// the admin. Returns the admin's id for such a type, or undefined when the parent is free to pick.
async function topLevelParent(userTypeId, req) {
  const type = userTypeId ? await userTypeRepo.findById(userTypeId) : null;
  if (!type || type.parent_type_id) return undefined;
  return adminIdOf(req);
}

// The type and parent a user would end up with: an empty parent means the admin.
async function resolveTarget(req, existing, b) {
  const typeId = b.userTypeId !== undefined && b.userTypeId !== '' ? intOrNull(b.userTypeId) : existing.user_type_id;
  const forced = await topLevelParent(typeId, req);
  let parentId = existing.parent_id;
  if (forced !== undefined) parentId = forced;
  else if (b.parentId !== undefined) parentId = intOrNull(b.parentId) || (await adminIdOf(req));
  return { typeId, parentId };
}

// What moving `existing` to type `typeId` under `parentId` would do. Used by the update itself
// and by the edit form's preview (GET /api/users/:id/change-impact).
async function changeImpact(existing, typeId, parentId) {
  const typeChanged = typeId !== existing.user_type_id;
  const parentChanged = parentId !== existing.parent_id;
  const parentError = typeChanged || parentChanged ? await checkParent(parentId, existing.id, typeId) : null;
  const below = new Set((await networkRepo.typesBelow(typeId)).map((t) => t.id));

  // Direct children whose type cannot stay under the new type (a Distributor turned Retailer).
  const children = typeChanged
    ? await db('users as u').leftJoin('user_types as ut', 'ut.id', 'u.user_type_id')
      .where('u.parent_id', existing.id).whereNotNull('u.user_type_id').orderBy('u.id')
      .select('u.id', 'u.user_code as code', 'u.full_name as name', 'u.user_type_id', 'ut.name as type')
    : [];
  let planCleared = false;
  if (typeChanged && existing.plan_id) {
    const plan = await db('plans').where({ id: existing.plan_id }).first('user_type_id');
    planCleared = !plan || plan.user_type_id !== typeId;
  }
  // Packages this user gives its own downline that no longer fit below the new type.
  const owned = typeChanged
    ? await db('commission_packages').where({ owner_user_id: existing.id, is_active: true }).orderBy('id').select('id', 'name', 'user_type_id')
    : [];
  return {
    typeChanged,
    parentChanged,
    fitsParent: !parentError,
    parentError,
    childrenMismatch: children.filter((c) => !below.has(c.user_type_id)),
    planCleared,
    packageCleared: (typeChanged || parentChanged) && !!existing.commission_package_id,
    ownedPackagesDeactivated: owned.filter((p) => !below.has(p.user_type_id)).map(({ id, name }) => ({ id, name })),
    signsOut: typeChanged,
  };
}

async function create(req, res, next) {
  try {
    const b = req.body;
    const nameErr = nameError(b);
    if (nameErr) return res.status(400).json(nameErr);
    if (!/^\d{10}$/.test(clean(b.mobile))) return res.status(400).json({ error: 'Mobile must be 10 digits', code: 'INVALID_MOBILE' });
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(b.email))) return res.status(400).json({ error: 'Enter a valid email', code: 'INVALID_EMAIL' });
    const userTypeId = intOrNull(b.userTypeId);
    if (!userTypeId || !(await userTypeRepo.findById(userTypeId))) return res.status(400).json({ error: 'Please select a valid account type', code: 'INVALID_USER_TYPE' });
    if (b.planId && !(await planRepo.findById(intOrNull(b.planId)))) return res.status(400).json({ error: 'Invalid plan', code: 'INVALID_PLAN' });
    if (String(b.password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters', code: 'WEAK_PASSWORD' });

    // No parent picked = the admin, so every user is in a chain; a picked parent must fit the type.
    const forcedParent = await topLevelParent(userTypeId, req);
    const parentId = forcedParent !== undefined ? forcedParent : (intOrNull(b.parentId) || (await adminIdOf(req)));
    if (forcedParent === undefined) {
      const parentErr = await checkParent(parentId, null, userTypeId);
      if (parentErr) return res.status(400).json(parentErr);
    }

    const passwordHash = await bcrypt.hash(String(b.password), 12);
    const fields = { ...mapFields(b), parent_id: parentId };
    const id = await createUserWithCode((code) => ({
      username: code, user_code: code, password_hash: passwordHash, role: 'user',
      wallet_balance: 0, kyc_status: 'pending', ekyc_status: 'pending',
      ...fields,
      created_by: req.user.id, // who created this user; never taken from the request body
    }));
    if (b.serviceAccess !== undefined) await permission.setUserServices(id, arr(b.serviceAccess), req.user.id);
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'user_created', detail: { newUserId: id, parentId: fields.parent_id || null }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.status(201).json({ row: await repo.findFull(id) });
  } catch (err) { return next(err); }
}

// PUT /api/users/:id — profile edits, plus a change of account type (role) or parent:
// the new type must fit under the parent, users below that no longer fit are moved
// (moveChildrenTo), and plan / packages / session follow. All of it in one transaction.
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await repo.findFull(id);
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const named = prepareName(req.body, existing); // name parts left out keep their saved value
    if (named.error) return res.status(400).json(named.error);
    const b = named.body;
    if (b.mobile !== undefined && !/^\d{10}$/.test(clean(b.mobile))) return res.status(400).json({ error: 'Mobile must be 10 digits', code: 'INVALID_MOBILE' });
    if (b.userTypeId !== undefined && !(await userTypeRepo.findById(intOrNull(b.userTypeId)))) return res.status(400).json({ error: 'Invalid account type', code: 'INVALID_USER_TYPE' });

    const { typeId, parentId } = await resolveTarget(req, existing, b);
    const impact = await changeImpact(existing, typeId, parentId);
    if (impact.parentError) return res.status(400).json(impact.parentError);

    // Users below who cannot stay under the new type must go somewhere else in the same save.
    let moveTo = null;
    if (impact.childrenMismatch.length) {
      if (b.moveChildrenTo === undefined || b.moveChildrenTo === null || b.moveChildrenTo === '') {
        const type = await userTypeRepo.findById(typeId);
        return res.status(409).json({
          error: `${impact.childrenMismatch.length} user(s) below cannot stay under a ${type ? type.name : 'user of this type'}. Choose where to move them.`,
          code: 'DOWNLINE_TYPE_MISMATCH',
          children: impact.childrenMismatch.map(({ user_type_id, ...c }) => c), // eslint-disable-line camelcase, no-unused-vars
        });
      }
      moveTo = b.moveChildrenTo === 'admin' ? await adminIdOf(req) : intOrNull(b.moveChildrenTo);
      if (!moveTo || moveTo === id || (await networkRepo.levelOf(id, moveTo))) {
        return res.status(400).json({ error: 'Move them to someone outside this user\'s own downline', code: 'PARENT_CYCLE' });
      }
      const target = await db('users').where({ id: moveTo }).first('id', 'role', 'user_type_id');
      if (!target || (target.role !== 'admin' && !target.user_type_id)) return res.status(400).json({ error: 'User to move them to was not found', code: 'INVALID_PARENT' });
      for (const c of impact.childrenMismatch) {
        // eslint-disable-next-line no-await-in-loop
        const fitErr = await checkParentFits(c.user_type_id, target);
        if (fitErr) return res.status(400).json({ error: `${c.code}: ${fitErr.error}`, code: fitErr.code });
      }
    }

    const fields = mapFields(b);
    delete fields.parent_id;
    if (impact.parentChanged) fields.parent_id = parentId;
    if (impact.typeChanged) {
      fields.user_type_id = typeId;
      fields.token_epoch = db.raw('token_epoch + 1'); // signed out: the next login gets the new panel and menu
      const planId = fields.plan_id !== undefined ? fields.plan_id : existing.plan_id;
      const plan = planId ? await db('plans').where({ id: planId }).first('user_type_id') : null;
      if (planId && (!plan || plan.user_type_id !== typeId)) fields.plan_id = null;
    }
    // Blocking signs the user out for good: every token issued before now stops working, so a later
    // unblock does not bring a stolen session back (the user logs in again).
    const blocked = fields.is_active === false && existing.is_active !== false;
    const unblocked = fields.is_active === true && existing.is_active === false;
    if (blocked) fields.token_epoch = db.raw('token_epoch + 1');
    // A received package was made for the old type and given by the old parent.
    if (impact.packageCleared) fields.commission_package_id = null;
    const movedIds = moveTo ? impact.childrenMismatch.map((c) => c.id) : [];
    const ownedIds = impact.ownedPackagesDeactivated.map((p) => p.id);

    await db.transaction(async (trx) => {
      await repo.update(id, fields, trx); // a user type change applies before the ticks are compared with its default
      if (movedIds.length) await trx('users').whereIn('id', movedIds).update({ parent_id: moveTo, commission_package_id: null, updated_at: trx.fn.now() });
      if (ownedIds.length) {
        await trx('commission_packages').whereIn('id', ownedIds).update({ is_active: false, updated_at: trx.fn.now() });
        await trx('users').whereIn('commission_package_id', ownedIds).update({ commission_package_id: null, updated_at: trx.fn.now() });
      }
    });
    if (b.serviceAccess !== undefined) await permission.setUserServices(id, arr(b.serviceAccess), req.user.id);

    const who = { userId: req.user.id, username: req.user.username, ip: req.ip, userAgent: req.get('user-agent') };
    if (blocked || unblocked) await audit.log({ ...who, event: blocked ? 'user_blocked' : 'user_unblocked', detail: { targetUserId: id } });
    if (impact.typeChanged) await audit.log({ ...who, event: 'user_type_changed', detail: { targetUserId: id, from: existing.user_type_id, to: typeId, packagesDeactivated: ownedIds } });
    if (impact.parentChanged) await audit.log({ ...who, event: 'user_parent_changed', detail: { targetUserId: id, from: existing.parent_id, to: parentId } });
    if (movedIds.length) await audit.log({ ...who, event: 'downline_moved', detail: { fromUserId: id, toUserId: moveTo, userIds: movedIds } });
    return res.json({ row: await repo.findFull(id), moved: movedIds.length, packagesDeactivated: ownedIds.length });
  } catch (err) { return next(err); }
}

// GET /api/users/:id/change-impact?userTypeId=&parentId= — preview of a type / parent change
// (parentId '' = the admin; left out = unchanged).
async function changeImpactPreview(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await repo.findFull(id);
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const q = req.query;
    if (q.userTypeId && !(await userTypeRepo.findById(intOrNull(q.userTypeId)))) return res.status(400).json({ error: 'Invalid account type', code: 'INVALID_USER_TYPE' });
    const { typeId, parentId } = await resolveTarget(req, existing, { userTypeId: q.userTypeId, parentId: q.parentId });
    const impact = await changeImpact(existing, typeId, parentId);
    return res.json({ ...impact, userTypeId: typeId, parentId });
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

// Money / commission history a delete would wipe (most of these tables cascade on users).
async function hasHistory(id) {
  const checks = [
    db('commission_ledger').where({ user_id: id }).orWhere({ source_user_id: id }).first('id'),
    db('service_transactions').where({ user_id: id }).first('id'),
    db('account_transactions').where({ user_id: id }).first('id'),
    db('fund_requests').where({ user_id: id }).first('id'),
    db('fund_transfers').where({ from_user_id: id }).orWhere({ to_user_id: id }).first('id'),
  ];
  return (await Promise.all(checks)).some(Boolean);
}

// DELETE /api/users/:id — only users with nobody below them and no history; others are deactivated.
async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findFull(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    if (await db('users').where({ parent_id: id }).first('id')) {
      return res.status(409).json({ error: 'This user has users under them. Move them to another parent first, or deactivate this user.', code: 'HAS_DOWNLINE' });
    }
    if (await hasHistory(id)) {
      return res.status(409).json({ error: 'This user has transactions or commission history. Deactivate the user instead so the records stay.', code: 'HAS_HISTORY' });
    }
    await db('users').where({ id }).del();
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

// POST /api/users/:id/reset-password  { newPassword? }  (admin only; managed users only - the admin account is not a managed user)
// Sets a temporary password (the one given, else a generated one, shown once in the answer and never stored or logged),
// signs the user out everywhere, clears a failed-login lock and makes them choose their own password at the next login.
async function resetPassword(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Number.isInteger(id) ? await repo.findFull(id) : null;
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const given = req.body && req.body.newPassword !== undefined && req.body.newPassword !== null ? String(req.body.newPassword) : '';
    if (given && given.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters`, code: 'WEAK_PASSWORD' });
    const password = given || generatePassword();
    const hash = await bcrypt.hash(password, 12);
    await db.transaction((trx) => userRepo.resetPassword(id, hash, trx));
    await audit.log({ userId: req.user.id, username: req.user.username, ip: req.ip, userAgent: req.get('user-agent'), event: 'password_reset', detail: { targetUserId: id, generated: !given } });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, password, generated: !given });
  } catch (err) { return next(err); }
}

module.exports = { list, search, create, update, changeImpactPreview, fund, remove, moduleOptions, resetPassword, createUserWithCode, mapFields, nameError, prepareName };
