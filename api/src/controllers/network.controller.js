'use strict';

const { parseGrid } = require('../utils/gridQuery');
const bcrypt = require('bcryptjs');
const repo = require('../repositories/network.repo');
const usersRepo = require('../repositories/usersManager.repo');
const fundRepo = require('../repositories/fundTransfer.repo');
const reportsRepo = require('../repositories/reports.repo');
const txnAuth = require('../services/txnAuth.service');
const audit = require('../repositories/audit.repo');
const { createUserWithCode, mapFields, nameError, prepareName } = require('./usersManager.controller');
const { checkAssignable } = require('./commissionPackage.controller');
const db = require('../config/db');

/**
 * Distributor / Master Distributor panel. The app reuses the admin screens (Users
 * Manager, Fund Transfer, All Fund Transfers, Service Report), so these endpoints
 * return the same shapes as the admin ones, but every query is limited to the
 * caller's own downline (req.user.id).
 */
const clean = (v) => String(v || '').trim();
const pageOf = (q) => ({
  page: Math.max(1, parseInt(q.page, 10) || 1),
  pageSize: Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 10)),
});
const intOrNull = (v) => (v ? parseInt(v, 10) || null : null);
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

// Fields only the admin may set. A distributor never sets them for their users.
const ADMIN_ONLY = ['kyc_status', 'ekyc_status', 'service_access', 'module_access', 'assigned_employee_id', 'parent_id', 'user_type_id', 'plan_id', 'merchant_id', 'min_balance'];
function userFields(body) {
  const out = mapFields(body || {});
  ADMIN_ONLY.forEach((k) => delete out[k]);
  return out;
}

// Gate: only user types that have a type below them get the network panel.
async function requireNetwork(req, res, next) {
  try {
    if (!(await repo.canHaveDownline(req.user.userTypeId))) {
      return res.status(403).json({ error: 'Your account type cannot manage a network', code: 'NO_NETWORK' });
    }
    return next();
  } catch (err) { return next(err); }
}

// GET /api/network/meta — who I am, my balance, and the user types (with plans) I may create.
async function getMeta(req, res, next) {
  try {
    const me = await db('users').where({ id: req.user.id }).first('wallet_balance');
    return res.json({ userId: req.user.id, walletBalance: Number(me.wallet_balance), childTypes: await repo.childTypes(req.user.userTypeId) });
  } catch (err) { return next(err); }
}

// GET /api/network/users — same filters and row shape as GET /api/users, downline only.
async function listUsers(req, res, next) {
  try {
    const f = pageOf(req.query);
    const { rows, total } = await usersRepo.list({
      q: clean(req.query.q), userTypeId: intOrNull(req.query.userTypeId), kycStatus: clean(req.query.kycStatus),
      accountStatus: clean(req.query.accountStatus), parentUser: clean(req.query.parentUser), downlineOf: req.user.id, ...f,
      grid: parseGrid(req.query, usersRepo.USERS_GRID),
    });
    return res.json({ rows, total, ...f });
  } catch (err) { return next(err); }
}

// GET /api/network/users/search?q&scope=direct|downline&userTypeId&id&userCode&limit — slim rows for the user picker.
// Always limited to the caller's own downline (scope=direct: only users directly under the caller).
async function searchUsers(req, res, next) {
  try {
    const rows = await usersRepo.search({
      q: clean(req.query.q), userCode: clean(req.query.userCode), id: intOrNull(req.query.id),
      userTypeIds: String(req.query.userTypeId || '').split(',').map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0),
      limit: parseInt(req.query.limit, 10) || 20, downlineOf: req.user.id, directOnly: req.query.scope === 'direct',
    });
    return res.json({ rows });
  } catch (err) { return next(err); }
}

// POST /api/network/users — same body as POST /api/users; the user is always placed under the caller.
async function createUser(req, res, next) {
  try {
    const b = req.body || {};
    const nameErr = nameError(b);
    if (nameErr) return res.status(400).json(nameErr);
    if (!/^\d{10}$/.test(clean(b.mobile))) return res.status(400).json({ error: 'Mobile must be 10 digits', code: 'INVALID_MOBILE' });
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(b.email))) return res.status(400).json({ error: 'Enter a valid email', code: 'INVALID_EMAIL' });
    if (String(b.password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters', code: 'WEAK_PASSWORD' });

    const types = await repo.childTypes(req.user.userTypeId);
    const type = types.find((t) => t.id === intOrNull(b.userTypeId));
    if (!type) return res.status(400).json({ error: `You can create: ${types.map((t) => t.name).join(', ')}`, code: 'INVALID_USER_TYPE' });
    const planId = intOrNull(b.planId);
    if (planId && !type.plans.some((p) => p.id === planId)) return res.status(400).json({ error: `Choose a plan made for ${type.name}`, code: 'INVALID_PLAN' });
    const packageId = intOrNull(b.commissionPackageId);
    const pkgErr = await checkAssignable(req.user.id, packageId, type.id);
    if (pkgErr) return res.status(400).json(pkgErr);

    const passwordHash = await bcrypt.hash(String(b.password), 12);
    const id = await createUserWithCode((code) => ({
      ...userFields(b),
      username: code, user_code: code, password_hash: passwordHash, role: 'user',
      user_type_id: type.id, plan_id: planId, parent_id: req.user.id, created_by: req.user.id, commission_package_id: packageId,
      wallet_balance: 0, kyc_status: 'pending', ekyc_status: 'pending',
    }));
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'user_created', detail: { newUserId: id, parentId: req.user.id, via: 'network' }, ...meta(req) });
    return res.status(201).json({ row: await usersRepo.findFull(id) });
  } catch (err) { return next(err); }
}

// PUT /api/network/users/:id — edit profile / block or unblock anyone in the downline.
// Plan can be changed only for users directly under the caller.
async function updateUser(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const level = await repo.levelOf(req.user.id, id);
    if (!level) return res.status(404).json({ error: 'User is not in your network', code: 'NOT_IN_NETWORK' });
    const named = prepareName(req.body || {}, await usersRepo.findFull(id)); // name parts left out keep their saved value
    if (named.error) return res.status(400).json(named.error);
    const b = named.body;
    if (b.mobile !== undefined && !/^\d{10}$/.test(clean(b.mobile))) return res.status(400).json({ error: 'Mobile must be 10 digits', code: 'INVALID_MOBILE' });
    const patch = userFields(b);

    if (b.planId !== undefined) {
      const planId = intOrNull(b.planId);
      const target = await db('users').where({ id }).first('user_type_id', 'plan_id');
      if (planId !== target.plan_id) {
        if (level !== 1) return res.status(400).json({ error: 'Only the user\'s direct parent can change their plan', code: 'NOT_DIRECT_DOWNLINE' });
        const type = (await repo.childTypes(req.user.userTypeId)).find((t) => t.id === target.user_type_id);
        if (planId && !(type && type.plans.some((p) => p.id === planId))) return res.status(400).json({ error: 'Choose a plan made for this user type', code: 'INVALID_PLAN' });
        patch.plan_id = planId;
      }
    }

    // Commission package: only the direct parent gives one (its own package, made for this user's type).
    if (b.commissionPackageId !== undefined) {
      const packageId = intOrNull(b.commissionPackageId);
      const target = await db('users').where({ id }).first('user_type_id', 'commission_package_id');
      if (packageId !== target.commission_package_id) {
        if (level !== 1) return res.status(400).json({ error: 'Only the direct parent can set a commission package', code: 'NOT_DIRECT_DOWNLINE' });
        const pkgErr = await checkAssignable(req.user.id, packageId, target.user_type_id);
        if (pkgErr) return res.status(400).json(pkgErr);
        patch.commission_package_id = packageId;
        await audit.log({ userId: req.user.id, username: req.user.username, event: 'commission_package_assigned', detail: { targetUserId: id, packageId }, ...meta(req) });
      }
    }

    await usersRepo.update(id, patch);
    if (patch.is_active === false) await db('users').where({ id }).increment('token_epoch', 1); // blocked users are signed out
    if (patch.is_active !== undefined) {
      await audit.log({ userId: req.user.id, username: req.user.username, event: patch.is_active ? 'network_user_unblocked' : 'network_user_blocked', detail: { targetUserId: id }, ...meta(req) });
    }
    return res.json({ row: await usersRepo.findFull(id) });
  } catch (err) { return next(err); }
}

// GET /api/network/lookup?code= — same shape as the admin lookup, direct users only.
async function lookup(req, res, next) {
  try {
    const code = clean(req.query.code);
    if (!code) return res.status(400).json({ error: 'Enter a User Id', code: 'NO_CODE' });
    const u = await db('users').whereRaw('lower(user_code) = lower(?)', [code]).where({ parent_id: req.user.id })
      .first('id', 'user_code', 'full_name', 'shop_name', 'mobile', 'wallet_balance');
    if (!u) return res.status(404).json({ error: 'No user with this User Id directly under you', code: 'NOT_FOUND' });
    return res.json({ user: { id: u.id, userCode: u.user_code, name: u.full_name, shopName: u.shop_name, mobile: u.mobile, walletBalance: u.wallet_balance } });
  } catch (err) { return next(err); }
}

// POST /api/network/fund-transfer { userId, amount, txnType, remark, transactionPassword }
// Zero-sum between the caller and a DIRECT downline user. Same response as the admin transfer.
async function fundTransfer(req, res, next) {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    const transferType = b.txnType === 'debit' ? 'debit' : (b.txnType === 'credit' ? 'credit' : null);
    if (!transferType) return res.status(400).json({ error: 'Choose a transaction type (credit/debit)', code: 'INVALID_TXN_TYPE' });
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return res.status(400).json({ error: 'Enter a valid amount', code: 'INVALID_AMOUNT' });
    const toUserId = intOrNull(b.userId);
    if ((await repo.levelOf(req.user.id, toUserId)) !== 1) return res.status(400).json({ error: 'You can only transfer to users directly under you', code: 'NOT_DIRECT_DOWNLINE' });
    const target = await db('users').where({ id: toUserId }).first('is_active');
    if (!target.is_active) return res.status(400).json({ error: 'This user is blocked', code: 'USER_BLOCKED' });

    if (!(await txnAuth.verify(req.user.id, b.transactionPassword))) return res.status(401).json({ error: 'Invalid transaction password/PIN', code: 'BAD_TXN_PASSWORD' });

    const me = await db('users').where({ id: req.user.id }).first('user_code', 'username');
    const result = await fundRepo.transfer({ fromUserId: req.user.id, toUserId, amount, transferType, remark: clean(b.remark), senderLabel: me.user_code || me.username });
    if (!result.ok) return res.status(400).json({ error: result.error, code: 'TRANSFER_FAILED' });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'fund_transfer', detail: { toUserId, amount, transferType, via: 'network' }, ...meta(req) });
    return res.status(201).json({ row: await fundRepo.findById(result.id) });
  } catch (err) { return next(err); }
}

// GET /api/network/fund-transfers — same filters and rows as GET /api/fund-transfers, my transfers only.
async function listTransfers(req, res, next) {
  try {
    const f = pageOf(req.query);
    const { rows, total } = await fundRepo.list({
      startDate: clean(req.query.startDate) || null, endDate: clean(req.query.endDate) || null,
      userTypeId: intOrNull(req.query.userTypeId), userId: intOrNull(req.query.userId),
      transferType: ['credit', 'debit'].includes(req.query.transferType) ? req.query.transferType : null,
      fromUserId: req.user.id, ...f, grid: parseGrid(req.query, fundRepo.GRID),
    });
    return res.json({ rows, total, ...f });
  } catch (err) { return next(err); }
}

// GET /api/network/report — same filters and rows as GET /api/service-report, downline only.
async function report(req, res, next) {
  try {
    const f = pageOf(req.query);
    const { rows, total } = await reportsRepo.serviceTransactions({
      startDate: clean(req.query.startDate) || null, endDate: clean(req.query.endDate) || null,
      userTypeId: intOrNull(req.query.userTypeId), userId: intOrNull(req.query.userId),
      service: clean(req.query.service) || null, status: clean(req.query.status) || null,
      downlineOf: req.user.id, ...f, grid: parseGrid(req.query, reportsRepo.SERVICE_GRID),
    });
    return res.json({ rows, total, ...f });
  } catch (err) { return next(err); }
}

// GET /api/network/summary — downline business summary for a distributor / super distributor.
async function summary(req, res, next) {
  try {
    const me = req.user.id;
    // Whole downline (recursive over parent_id).
    const dl = await db.raw(
      `WITH RECURSIVE dl AS (
         SELECT id FROM users WHERE parent_id = ?
         UNION ALL
         SELECT u.id FROM users u JOIN dl ON u.parent_id = dl.id)
       SELECT id FROM dl`, [me],
    );
    const ids = dl.rows.map((r) => r.id);

    // Downline user counts.
    let users = { total: 0, active: 0, walletTotal: 0 };
    let byType = [];
    if (ids.length) {
      users = await db('users').whereIn('id', ids).first(
        db.raw('count(*)::int as total'),
        db.raw('count(*) FILTER (WHERE is_active)::int as active'),
        db.raw('COALESCE(sum(wallet_balance), 0) as "walletTotal"'),
      );
      byType = await db('users as u').whereIn('u.id', ids)
        .join('user_types as ut', 'ut.id', 'u.user_type_id')
        .groupBy('ut.name').orderBy('ut.name')
        .select('ut.name', db.raw('count(*)::int as count'));
    }

    // Downline transaction volume.
    const txnAgg = (whereRaw) => {
      const q = db('service_transactions').whereIn('user_id', ids.length ? ids : [0]);
      if (whereRaw) q.whereRaw(whereRaw);
      return q.first(db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'));
    };
    const txToday = await txnAgg('created_at::date = CURRENT_DATE');
    const txMonth = await txnAgg("date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)");

    // My commission (what I earn out of my downline's business).
    const commAgg = (whereRaw) => db('commission_ledger').where({ user_id: me, wallet_txn_type: 'credit' }).where('level', '>', 0) // only from the downline
      .modify((q) => { if (whereRaw) q.whereRaw(whereRaw); }).sum('net_amount as amt').first();
    const commToday = await commAgg('created_at::date = CURRENT_DATE');
    const commMonth = await commAgg("date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)");

    // Pending fund requests raised by my downline.
    const fr = ids.length
      ? await db('fund_requests').whereIn('user_id', ids).where({ status: 'pending' })
        .first(db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'))
      : { cnt: 0, amt: 0 };

    return res.json({
      downline: {
        total: Number(users.total || 0),
        active: Number(users.active || 0),
        walletTotal: Number(users.walletTotal || 0),
        byType,
      },
      txToday: { count: txToday.cnt, amount: Number(txToday.amt) },
      txMonth: { count: txMonth.cnt, amount: Number(txMonth.amt) },
      commissionToday: Number((commToday && commToday.amt) || 0),
      commissionMonth: Number((commMonth && commMonth.amt) || 0),
      fundRequests: { pending: Number(fr.cnt || 0), amount: Number(fr.amt || 0) },
    });
  } catch (err) { return next(err); }
}

module.exports = { requireNetwork, getMeta, listUsers, searchUsers, createUser, updateUser, lookup, fundTransfer, listTransfers, report, summary };
