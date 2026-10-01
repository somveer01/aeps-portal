'use strict';

const db = require('../config/db');
const permission = require('../services/servicePermission.service');
const audit = require('../repositories/audit.repo');

const ids = (v) => (Array.isArray(v) ? v : [v]).map((x) => parseInt(x, 10)).filter(Number.isFinite);
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const bad = (res, error, code) => res.status(400).json({ error, code });

// GET /api/service-permissions/matrix -> every service x every user type, and which cells are allowed.
async function matrix(req, res, next) {
  try {
    const [services, userTypes, allowed] = await Promise.all([
      db('services').orderBy('id').select('id', 'title', 'is_active'),
      db('user_types').orderBy('id').select('id', 'name', 'is_active'),
      db('user_type_services').select('user_type_id as userTypeId', 'service_id as serviceId'),
    ]);
    return res.json({ services, userTypes, allowed });
  } catch (err) { return next(err); }
}

// PUT /api/service-permissions/matrix { userTypeId?, serviceId?, allowed }
// Both ids -> one cell; only serviceId -> that service for every type; only userTypeId -> every service for that type.
async function setMatrix(req, res, next) {
  try {
    const b = req.body || {};
    if (typeof b.allowed !== 'boolean') return bad(res, 'allowed must be true or false', 'INVALID_ALLOWED');
    if (b.userTypeId == null && b.serviceId == null) return bad(res, 'Choose a user type or a service', 'MISSING_TARGET');
    const typeIds = b.userTypeId != null ? ids(b.userTypeId) : (await db('user_types').select('id')).map((r) => r.id);
    const serviceIds = b.serviceId != null ? ids(b.serviceId) : (await db('services').select('id')).map((r) => r.id);
    if (b.userTypeId != null && !(await db('user_types').whereIn('id', typeIds).first('id'))) return bad(res, 'User type not found', 'INVALID_USER_TYPE');
    if (b.serviceId != null && !(await db('services').whereIn('id', serviceIds).first('id'))) return bad(res, 'Service not found', 'INVALID_SERVICE');
    await permission.setTypeServices(typeIds, serviceIds, b.allowed, req.user.id);
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'service_permission_changed', detail: { level: 'user_type', userTypeId: b.userTypeId ?? 'all', serviceId: b.serviceId ?? 'all', allowed: b.allowed }, ...meta(req) });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

// GET /api/service-permissions/services/:serviceId/users?q&userTypeId&status(allowed|blocked)&page&pageSize
async function serviceUsers(req, res, next) {
  try {
    const serviceId = parseInt(req.params.serviceId, 10);
    const svc = await db('services').where({ id: serviceId }).first('id', 'title', 'is_active');
    if (!svc) return res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const q = String(req.query.q || '').trim();
    const userTypeId = parseInt(req.query.userTypeId, 10) || null;
    const status = String(req.query.status || '');
    const effective = 'coalesce(o.allowed, t.service_id is not null)';

    const base = db('users as u')
      .join('user_types as ut', 'ut.id', 'u.user_type_id')
      .leftJoin('user_type_services as t', (j) => j.on('t.user_type_id', 'u.user_type_id').andOn('t.service_id', db.raw('?', [serviceId])))
      .leftJoin('user_service_overrides as o', (j) => j.on('o.user_id', 'u.id').andOn('o.service_id', db.raw('?', [serviceId])))
      .whereNotNull('u.user_type_id');
    if (q) base.where((w) => w.whereILike('u.user_code', `%${q}%`).orWhereILike('u.full_name', `%${q}%`).orWhereILike('u.mobile', `%${q}%`));
    if (userTypeId) base.where('u.user_type_id', userTypeId);
    if (status === 'allowed') base.whereRaw(effective);
    if (status === 'blocked') base.whereRaw(`not ${effective}`);

    const countRow = await base.clone().count('u.id as c').first();
    const rows = await base.clone()
      .select('u.id', 'u.user_code', 'u.full_name as name', 'u.mobile', 'u.is_active', 'ut.name as user_type_name',
        db.raw('(t.service_id is not null) as type_default'), 'o.allowed as override', db.raw(`${effective} as effective`))
      .orderBy('u.id').limit(pageSize).offset((page - 1) * pageSize);
    return res.json({ service: svc, rows, total: Number(countRow.c), page, pageSize });
  } catch (err) { return next(err); }
}

// PUT /api/service-permissions/services/:serviceId/users { userIds:[], mode: 'allow'|'block'|'default' }
async function setServiceUsers(req, res, next) {
  try {
    const serviceId = parseInt(req.params.serviceId, 10);
    if (!(await db('services').where({ id: serviceId }).first('id'))) return res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' });
    const { mode } = req.body || {};
    if (!['allow', 'block', 'default'].includes(mode)) return bad(res, 'mode must be allow, block or default', 'INVALID_MODE');
    const userIds = ids((req.body && req.body.userIds) || []);
    if (!userIds.length) return bad(res, 'Select at least one user', 'NO_USERS');
    const found = (await db('users').whereIn('id', userIds).whereNotNull('user_type_id').select('id')).map((r) => r.id);
    if (found.length !== new Set(userIds).size) return bad(res, 'Only portal users can be selected', 'INVALID_USERS');
    await permission.setOverrides(serviceId, found, mode, req.user.id);
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'service_permission_changed', detail: { level: 'user', serviceId, userIds: found, mode }, ...meta(req) });
    return res.json({ ok: true, updated: found.length });
  } catch (err) { return next(err); }
}

module.exports = { matrix, setMatrix, serviceUsers, setServiceUsers };
