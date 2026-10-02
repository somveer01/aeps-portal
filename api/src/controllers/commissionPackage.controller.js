'use strict';

const db = require('../config/db');
const repo = require('../repositories/commissionPackage.repo');
const networkRepo = require('../repositories/network.repo');
const audit = require('../repositories/audit.repo');
const { parseGrid } = require('../utils/gridQuery');

const clean = (v) => String(v || '').trim();
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const bad = (res, error, code, status = 400) => res.status(status).json({ error, code });
const pageOf = (q) => ({ page: Math.max(1, parseInt(q.page, 10) || 1), pageSize: Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 10)) });

// Credit slabs for every operator / any user (the default a package starts from).
const plainSlabs = () => db('commission_slots as cs').join('services as s', 's.id', 'cs.service_id').leftJoin('plans as p', 'p.id', 'cs.plan_id')
  .where({ 'cs.is_active': true, 'cs.txn_type': 'credit' })
  .whereRaw("coalesce(trim(cs.operator), '') = ''").whereRaw("coalesce(trim(cs.specific_user), '') = ''");

/**
 * For each child type I can serve: the services that type may use (Service Permissions), the
 * admin default per plan, my own chain share, and the most I can give (default + my share).
 * `max` is null when the default and my share are of different kinds (% vs Rs); the engine
 * still caps every payout at what I actually earn.
 */
async function buildMeta(user) {
  const me = await db('users').where({ id: user.id }).first('user_type_id', 'plan_id');
  const types = await networkRepo.childTypes(me.user_type_id);
  const out = [];
  for (const t of types) {
    // eslint-disable-next-line no-await-in-loop
    const services = await db('user_type_services as uts').join('services as s', 's.id', 'uts.service_id')
      .where({ 'uts.user_type_id': t.id, 's.is_active': true }).orderBy('s.title').select('s.id', 's.title');
    const ids = services.map((s) => s.id);
    // eslint-disable-next-line no-await-in-loop
    const defaults = ids.length ? await plainSlabs().where('cs.user_type_id', t.id).whereIn('cs.service_id', ids)
      .select('cs.service_id', 'cs.commission_type', 'cs.value', 'p.name as plan_name') : [];
    const mineQ = plainSlabs().where({ 'cs.user_type_id': me.user_type_id, 'cs.chain_type': 'chain' }).whereIn('cs.service_id', ids.length ? ids : [0]);
    if (me.plan_id) mineQ.where('cs.plan_id', me.plan_id);
    // eslint-disable-next-line no-await-in-loop
    const mine = await mineQ.orderBy('cs.id').select('cs.service_id', 'cs.commission_type', 'cs.value');
    out.push({
      id: t.id, name: t.name,
      services: services.map((s) => {
        const def = defaults.filter((d) => d.service_id === s.id).map((d) => ({ plan: d.plan_name, type: d.commission_type, value: Number(d.value) }));
        const my = mine.find((m) => m.service_id === s.id);
        const myShare = my ? { type: my.commission_type, value: Number(my.value) } : null;
        const kinds = new Set([...def.map((d) => d.type), ...(myShare ? [myShare.type] : [])]);
        const top = def.length ? Math.max(...def.map((d) => d.value)) : 0;
        const max = kinds.size <= 1 ? Math.round((top + (myShare ? myShare.value : 0)) * 100) / 100 : null;
        return { serviceId: s.id, title: s.title, defaults: def, myShare, max, maxType: kinds.size === 1 ? [...kinds][0] : (kinds.size === 0 ? 'percentage' : null) };
      }),
    });
  }
  return out;
}

// GET /api/network/packages/meta
async function getMeta(req, res, next) {
  try { return res.json({ childTypes: await buildMeta(req.user) }); } catch (err) { return next(err); }
}

// GET /api/network/packages (DataGrid sort/filter)
async function list(req, res, next) {
  try {
    const f = pageOf(req.query);
    const { rows, total } = await repo.list({ ownerId: req.user.id, grid: parseGrid(req.query, repo.GRID), ...f });
    return res.json({ rows, total, ...f });
  } catch (err) { return next(err); }
}

// GET /api/commission-packages (admin, read-only: every upline's packages)
async function adminList(req, res, next) {
  try {
    const f = pageOf(req.query);
    const { rows, total } = await repo.list({ grid: parseGrid(req.query, repo.GRID), ...f });
    return res.json({ rows, total, ...f });
  } catch (err) { return next(err); }
}

async function validate(req) {
  const b = req.body || {};
  const name = clean(b.name);
  if (name.length < 2) return { error: 'Give the package a name', code: 'INVALID_NAME' };
  const metaTypes = await buildMeta(req.user);
  const type = metaTypes.find((t) => t.id === parseInt(b.userTypeId, 10));
  if (!type) return { error: `Packages can be made for: ${metaTypes.map((t) => t.name).join(', ') || 'nobody (no user type below yours)'}`, code: 'INVALID_USER_TYPE' };
  const raw = Array.isArray(b.items) ? b.items : [];
  const items = [];
  const seen = new Set();
  for (const it of raw) {
    const svc = type.services.find((s) => s.serviceId === parseInt(it.serviceId, 10));
    if (!svc) return { error: `${type.name} cannot use this service (Service Permissions)`, code: 'INVALID_SERVICE' };
    const commissionType = it.commissionType === 'amount' ? 'amount' : 'percentage';
    const value = Number(it.value);
    if (!Number.isFinite(value) || value < 0) return { error: `Enter a valid commission for ${svc.title}`, code: 'INVALID_VALUE' };
    if (commissionType === 'percentage' && value > 100) return { error: `${svc.title}: percentage cannot exceed 100`, code: 'INVALID_VALUE' };
    if (svc.max != null && svc.maxType === commissionType && value > svc.max) {
      return { error: `${svc.title}: you can give at most ${commissionType === 'amount' ? `Rs ${svc.max}` : `${svc.max}%`} (the admin default plus your own share)`, code: 'ABOVE_YOUR_SHARE' };
    }
    const operator = clean(it.operator) || null;
    const key = `${svc.serviceId}:${(operator || '').toLowerCase()}`;
    if (seen.has(key)) return { error: `${svc.title} is listed twice`, code: 'DUPLICATE_SERVICE' };
    seen.add(key);
    items.push({ serviceId: svc.serviceId, operator, commissionType, value });
  }
  if (!items.length) return { error: 'Add at least one service rate', code: 'NO_ITEMS' };
  return { name, userTypeId: type.id, isActive: b.isActive !== false, items };
}

// POST /api/network/packages { name, userTypeId, isActive, items: [{ serviceId, operator?, commissionType, value }] }
async function create(req, res, next) {
  try {
    const v = await validate(req);
    if (v.error) return bad(res, v.error, v.code);
    if (await db('commission_packages').where({ owner_user_id: req.user.id }).whereRaw('lower(name) = lower(?)', [v.name]).first('id')) return bad(res, 'You already have a package with this name', 'DUPLICATE_NAME');
    const id = await repo.save(req.user.id, v);
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'commission_package_created', detail: { id, name: v.name, items: v.items }, ...meta(req) });
    return res.status(201).json({ row: await repo.find(id, req.user.id) });
  } catch (err) { return next(err); }
}

// PUT /api/network/packages/:id
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const before = await repo.find(id, req.user.id);
    if (!before) return bad(res, 'Package not found', 'NOT_FOUND', 404);
    const v = await validate(req);
    if (v.error) return bad(res, v.error, v.code);
    if (v.userTypeId !== before.user_type_id && await repo.usersOf(id)) return bad(res, 'Unassign the users first to change who this package is for', 'IN_USE');
    if (await db('commission_packages').where({ owner_user_id: req.user.id }).whereRaw('lower(name) = lower(?)', [v.name]).whereNot({ id }).first('id')) return bad(res, 'You already have a package with this name', 'DUPLICATE_NAME');
    await repo.save(req.user.id, { ...v, id });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'commission_package_updated', detail: { id, before: before.items, after: v.items }, ...meta(req) });
    return res.json({ row: await repo.find(id, req.user.id) });
  } catch (err) { return next(err); }
}

// DELETE /api/network/packages/:id[?unassign=1]
async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const pkg = await repo.find(id, req.user.id);
    if (!pkg) return bad(res, 'Package not found', 'NOT_FOUND', 404);
    const users = await repo.usersOf(id);
    if (users && req.query.unassign !== '1') return bad(res, `${users} user(s) use this package. Delete with "unassign" to move them back to the admin default.`, 'IN_USE', 409);
    await repo.remove(id, req.user.id, { unassign: true });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'commission_package_deleted', detail: { id, name: pkg.name, unassigned: users }, ...meta(req) });
    return res.json({ ok: true, unassigned: users });
  } catch (err) { return next(err); }
}

/**
 * Can `ownerId` give package `packageId` to a direct child of type `childTypeId`?
 * Returns an error object or null. A null / '' package means "admin default".
 */
async function checkAssignable(ownerId, packageId, childTypeId) {
  if (!packageId) return null;
  const pkg = await db('commission_packages').where({ id: packageId, owner_user_id: ownerId }).first('user_type_id', 'is_active');
  if (!pkg) return { error: 'Choose one of your own commission packages', code: 'INVALID_PACKAGE' };
  if (!pkg.is_active) return { error: 'This package is switched off', code: 'INVALID_PACKAGE' };
  if (pkg.user_type_id !== childTypeId) return { error: 'This package is made for another user type', code: 'INVALID_PACKAGE' };
  return null;
}

module.exports = { getMeta, list, adminList, create, update, remove, checkAssignable };
