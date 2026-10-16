'use strict';

const { parseGrid } = require('../utils/gridQuery');
const db = require('../config/db');
const repo = require('../repositories/apiProvider.repo');
const audit = require('../repositories/audit.repo');
const registry = require('../services/providers');
const permission = require('../services/servicePermission.service');
const { operatorOptions } = require('../services/operatorOptions');

/**
 * API Management (admin): API Configuration, SP Keys & Commission, Product Switch (service -> API),
 * Customer Switch (one user's API per service + allow / block). The money pipeline reads these through
 * services/providerRouter.service.js. Tokens never leave the server (see apiProvider.repo view()).
 */
const clean = (v) => String(v === undefined || v === null ? '' : v).trim();
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const bad = (res, code, error, status = 400) => res.status(status).json({ error, code });
const send = (e, res, next) => (e.status && e.code ? res.status(e.status).json({ error: e.message, code: e.code }) : next(e));
const pageOf = (q) => ({ page: Math.max(1, parseInt(q.page, 10) || 1), pageSize: Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 10)) });
const log = (req, event, detail) => audit.log({ userId: req.user.id, username: req.user.username, event, detail, ...meta(req) });

const COMMISSION_TYPES = ['percent', 'flat', 'surcharge', 'surcharge_percent'];
const MOCK = 'MOCK';

// ── API Configuration ─────────────────────────────────────────────
function readProvider(body, existing) {
  const b = body || {};
  const f = {};
  const err = (code, msg) => ({ error: { code, msg } });
  if (!existing || b.name !== undefined) {
    f.name = clean(b.name);
    if (f.name.length < 2 || f.name.length > 100) return err('INVALID_NAME', 'Enter the API name (2-100 characters)');
  }
  if (!existing || b.code !== undefined) {
    f.code = clean(b.code).toUpperCase();
    if (!/^[A-Z0-9_]{2,40}$/.test(f.code)) return err('INVALID_CODE', 'Code: 2-40 capital letters, digits or _ (e.g. PAYSPRINT)');
    if (existing && existing.code === MOCK && f.code !== MOCK) return err('PROTECTED', 'The Mock Provider keeps its code');
  }
  if (!existing || b.adapter !== undefined) {
    f.adapter = clean(b.adapter) || 'custom';
    if (!registry.ADAPTERS[f.adapter]) return err('INVALID_ADAPTER', 'Choose how this API is connected');
    if (existing && existing.code === MOCK && f.adapter !== 'mock') return err('PROTECTED', 'The Mock Provider always uses the mock adapter');
  }
  if (b.baseUrl !== undefined) {
    f.baseUrl = clean(b.baseUrl);
    if (f.baseUrl && (!/^https?:\/\/[^\s]+$/i.test(f.baseUrl) || f.baseUrl.length > 500)) return err('INVALID_URL', 'Endpoint URL must start with http:// or https://');
  }
  if (b.username !== undefined) {
    f.username = clean(b.username);
    if (f.username.length > 150) return err('INVALID_USERNAME', 'Username is too long');
  }
  if (b.token !== undefined) {
    f.token = clean(b.token);
    if (f.token.length > 2000) return err('INVALID_TOKEN', 'Token / key is too long');
  }
  if (b.password !== undefined) {
    f.password = String(b.password); // not trimmed: a password may start or end with a space
    if (f.password.length > 500) return err('INVALID_PASSWORD', 'Password is too long');
  }
  if (b.callbackSecret !== undefined) {
    f.callbackSecret = clean(b.callbackSecret);
    if (f.callbackSecret.length > 500) return err('INVALID_SECRET', 'Callback secret is too long');
  }
  if (b.description !== undefined) f.description = clean(b.description).slice(0, 1000);
  if (b.isActive !== undefined) f.isActive = !!b.isActive;
  return { f };
}

// What changed, for the audit log: field names only - token / secret values are never logged.
const SECRET_FIELDS = { token: 'token (changed)', password: 'password (changed)', callbackSecret: 'callback secret (changed)' };
const changedFields = (f) => Object.keys(f).map((k) => SECRET_FIELDS[k] || k);

async function listProviders(req, res, next) {
  try {
    const p = pageOf(req.query);
    const { rows, total } = await repo.list({ q: clean(req.query.q), ...p, grid: parseGrid(req.query, repo.GRID) });
    return res.json({ rows, total, ...p, adapters: registry.adapterList() });
  } catch (e) { return next(e); }
}

async function providerOptions(req, res, next) {
  try { return res.json({ rows: await repo.options(), adapters: registry.adapterList() }); } catch (e) { return next(e); }
}

async function createProvider(req, res, next) {
  try {
    const { f, error } = readProvider(req.body);
    if (error) return bad(res, error.code, error.msg);
    if (await repo.findByCode(f.code)) return bad(res, 'DUPLICATE_CODE', `Code ${f.code} is already used by another API`, 409);
    const id = await repo.create(f, req.user.id);
    await log(req, 'api_provider_created', { id, code: f.code, fields: changedFields(f) });
    return res.status(201).json({ row: await repo.findView(id) });
  } catch (e) { return send(e, res, next); }
}

async function updateProvider(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await repo.findById(id);
    if (!existing) return bad(res, 'NOT_FOUND', 'API not found', 404);
    const { f, error } = readProvider(req.body, existing);
    if (error) return bad(res, error.code, error.msg);
    if (f.code && f.code !== existing.code && await repo.findByCode(f.code)) return bad(res, 'DUPLICATE_CODE', `Code ${f.code} is already used by another API`, 409);
    if (f.isActive === false && existing.code === MOCK) {
      return bad(res, 'PROTECTED', 'The Mock Provider is the default for every service without its own API. Give those services an API in Product Switch instead.', 409);
    }
    await repo.update(id, f, req.user.id);
    await log(req, 'api_provider_updated', { id, code: existing.code, fields: changedFields(f) });
    return res.json({ row: await repo.findView(id) });
  } catch (e) { return send(e, res, next); }
}

async function removeProvider(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await repo.findView(id);
    if (!row) return bad(res, 'NOT_FOUND', 'API not found', 404);
    if (row.code === MOCK) return bad(res, 'PROTECTED', 'The Mock Provider cannot be deleted', 409);
    if (row.txn_count > 0) return bad(res, 'HAS_HISTORY', `${row.name} has ${row.txn_count} transaction(s). Switch it off instead of deleting it.`, 409);
    const used = Number(row.services_routed) + Number((await db('user_service_routes').where({ provider_id: id }).count('id as c').first()).c);
    if (used > 0) return bad(res, 'IN_USE', `${row.name} is still chosen in Product Switch / Customer Switch. Move those services to another API first.`, 409);
    await repo.remove(id); // its SP keys go with it (cascade)
    await log(req, 'api_provider_deleted', { id, code: row.code });
    return res.json({ ok: true });
  } catch (e) { return send(e, res, next); }
}

async function testProvider(req, res, next) {
  try {
    const row = await repo.findById(parseInt(req.params.id, 10));
    if (!row) return bad(res, 'NOT_FOUND', 'API not found', 404);
    let r;
    try { r = await registry.ping(row); } catch (e) { r = { ok: false, message: e.message || 'Connection failed' }; }
    await log(req, 'api_provider_tested', { id: row.id, code: row.code, ok: r.ok });
    return res.json(r);
  } catch (e) { return send(e, res, next); }
}

// ── SP Keys & Commission ──────────────────────────────────────────
// For each service: how many SP key rows this API has.
async function spKeyServices(req, res, next) {
  try {
    const providerId = parseInt(req.query.providerId, 10) || 0;
    const rows = await db('services as s').leftJoin('service_categories as c', 'c.id', 's.service_category_id')
      .select('s.id', 's.title', 's.is_active', 'c.name as category_name',
        db.raw("(select count(*)::int from provider_products pp where pp.service_id = s.id and pp.provider_id = ? and pp.is_active and coalesce(pp.sp_key, '') <> '') as mapped", [providerId]))
      .orderBy('c.name').orderBy('s.title');
    return res.json({ rows });
  } catch (e) { return next(e); }
}

async function getSpKeys(req, res, next) {
  try {
    const providerId = parseInt(req.query.providerId, 10);
    const serviceId = parseInt(req.query.serviceId, 10);
    const provider = providerId ? await repo.findById(providerId) : null;
    const service = serviceId ? await db('services').where({ id: serviceId }).first('id', 'title') : null;
    if (!provider || !service) return bad(res, 'NOT_FOUND', 'Choose an API and a service', 404);
    const { kind, options } = await operatorOptions(serviceId);
    const saved = await db('provider_products').where({ provider_id: providerId, service_id: serviceId })
      .select('id', 'operator', 'sp_key', 'commission_type', 'commission_value', 'is_active', 'updated_at');
    const byOp = new Map(saved.map((r) => [r.operator.toLowerCase(), r]));
    const blank = (operator) => ({ id: null, operator, sp_key: '', commission_type: 'percent', commission_value: 0, is_active: true, updated_at: null });
    const names = ['', ...options, ...saved.map((r) => r.operator).filter((o) => o && !options.some((x) => x.toLowerCase() === o.toLowerCase()))];
    const rows = names.map((o) => {
      const r = byOp.get(o.toLowerCase());
      return r ? { ...r, commission_value: Number(r.commission_value) } : blank(o);
    });
    return res.json({
      provider: { id: provider.id, name: provider.name, code: provider.code, adapter: provider.adapter, needsSpKey: registry.needsSpKey(provider.adapter) },
      service, kind, rows, commissionTypes: COMMISSION_TYPES,
    });
  } catch (e) { return next(e); }
}

async function saveSpKeys(req, res, next) {
  try {
    const providerId = parseInt(req.body && req.body.providerId, 10);
    const serviceId = parseInt(req.body && req.body.serviceId, 10);
    const provider = providerId ? await repo.findById(providerId) : null;
    const service = serviceId ? await db('services').where({ id: serviceId }).first('id', 'title') : null;
    if (!provider || !service) return bad(res, 'NOT_FOUND', 'Choose an API and a service', 404);
    const list = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!list.length || list.length > 500) return bad(res, 'INVALID_ROWS', 'Nothing to save');
    const { options } = await operatorOptions(serviceId);
    const existingOps = (await db('provider_products').where({ provider_id: providerId, service_id: serviceId }).select('operator')).map((r) => r.operator);
    const known = [...options, ...existingOps];

    const rows = [];
    for (const r of list) {
      const opIn = clean(r.operator);
      const operator = opIn ? known.find((o) => o.toLowerCase() === opIn.toLowerCase()) : '';
      if (operator === undefined) return bad(res, 'INVALID_OPERATOR', `${opIn} is not an operator of ${service.title}`);
      const spKey = clean(r.spKey);
      if (spKey.length > 100) return bad(res, 'INVALID_SP_KEY', `SP key for ${operator || 'All operators'} is too long`);
      const type = COMMISSION_TYPES.includes(r.commissionType) ? r.commissionType : null;
      if (!type) return bad(res, 'INVALID_TYPE', 'Commission type must be %, FLAT, Surcharge or Surcharge %');
      const value = Number(r.commissionValue === '' || r.commissionValue === undefined ? 0 : r.commissionValue);
      if (!Number.isFinite(value) || value < 0 || value > 100000) return bad(res, 'INVALID_VALUE', `Enter a valid value for ${operator || 'All operators'}`);
      if (type.endsWith('percent') && value > 100) return bad(res, 'INVALID_VALUE', `A percentage cannot be above 100 (${operator || 'All operators'})`);
      rows.push({ operator, spKey, type, value, isActive: r.isActive !== false });
    }

    let saved = 0; let cleared = 0;
    await db.transaction(async (trx) => {
      for (const r of rows) {
        if (!r.spKey && r.value === 0) {
          // An empty row means "not set": remove it, so the "All operators" row (or nothing) applies.
          // eslint-disable-next-line no-await-in-loop
          cleared += await trx('provider_products').where({ provider_id: providerId, service_id: serviceId, operator: r.operator }).del();
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await trx('provider_products').insert({
          provider_id: providerId, service_id: serviceId, operator: r.operator, sp_key: r.spKey || null, commission_type: r.type,
          commission_value: r.value, is_active: r.isActive, updated_by: req.user.id, updated_at: trx.fn.now(),
        }).onConflict(['provider_id', 'service_id', 'operator']).merge(['sp_key', 'commission_type', 'commission_value', 'is_active', 'updated_by', 'updated_at']);
        saved += 1;
      }
    });
    await log(req, 'api_sp_keys_saved', { providerId, serviceId, saved, cleared });
    return res.json({ ok: true, saved, cleared });
  } catch (e) { return send(e, res, next); }
}

// ── Product Switch / Customer Switch shared ───────────────────────
// providerId -> Set(serviceId) the API is ready for: the mock adapter needs no SP key; others need one.
async function readiness() {
  const providers = await repo.options();
  const keyed = await db('provider_products').where({ is_active: true }).whereRaw("coalesce(sp_key, '') <> ''").distinct('provider_id', 'service_id');
  const map = new Map(providers.map((p) => [p.id, new Set()]));
  keyed.forEach((k) => { if (map.has(k.provider_id)) map.get(k.provider_id).add(k.service_id); });
  const ready = (p, serviceId) => p.is_active && (!registry.needsSpKey(p.adapter) || map.get(p.id).has(serviceId));
  return { providers, mock: providers.find((p) => p.code === MOCK) || null, ready };
}

async function checkProvider(ctx, providerId, serviceId, title) {
  const p = ctx.providers.find((x) => x.id === providerId);
  if (!p) return `Choose a valid API for ${title}`;
  if (!p.is_active) return `${p.name} is switched off (${title})`;
  if (!ctx.ready(p, serviceId)) return `${p.name} has no SP key for ${title}. Add it in SP Keys & Commission first.`;
  return null;
}

// ── Product Switch ────────────────────────────────────────────────
async function productSwitch(req, res, next) {
  try {
    const ctx = await readiness();
    const q = clean(req.query.q);
    const categoryId = parseInt(req.query.categoryId, 10) || null;
    const qb = db('services as s').leftJoin('service_categories as c', 'c.id', 's.service_category_id')
      .leftJoin('service_routes as r', 'r.service_id', 's.id').leftJoin('api_providers as p', 'p.id', 'r.provider_id');
    if (q) qb.whereILike('s.title', `%${q}%`);
    if (categoryId) qb.where('s.service_category_id', categoryId);
    const rows = await qb.select('s.id as service_id', 's.title', 's.is_active', 'c.name as category_name', 'r.provider_id', 'p.name as provider_name', 'r.updated_at')
      .orderBy('c.name').orderBy('s.title');
    return res.json({
      rows: rows.map((r) => ({ ...r, ready_provider_ids: ctx.providers.filter((p) => ctx.ready(p, r.service_id)).map((p) => p.id) })),
      providers: ctx.providers, defaultProviderId: ctx.mock ? ctx.mock.id : null,
    });
  } catch (e) { return next(e); }
}

// PUT { rows: [{ serviceId, providerId (null = default Mock), isActive }] }
async function saveProductSwitch(req, res, next) {
  try {
    const list = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!list.length || list.length > 500) return bad(res, 'INVALID_ROWS', 'Nothing to save');
    const ctx = await readiness();
    const ids = list.map((r) => parseInt(r.serviceId, 10)).filter(Boolean);
    const services = new Map((await db('services').whereIn('id', ids).select('id', 'title', 'is_active')).map((s) => [s.id, s]));
    const plan = [];
    for (const r of list) {
      const svc = services.get(parseInt(r.serviceId, 10));
      if (!svc) return bad(res, 'NOT_FOUND', 'Service not found', 404);
      // providerId left out = API unchanged; null = back to the default (Mock).
      let providerId = r.providerId === undefined ? undefined : (r.providerId ? parseInt(r.providerId, 10) : null);
      if (ctx.mock && providerId === ctx.mock.id) providerId = null; // the default needs no row
      if (providerId) {
        // eslint-disable-next-line no-await-in-loop
        const problem = await checkProvider(ctx, providerId, svc.id, svc.title);
        if (problem) return bad(res, 'PROVIDER_NOT_READY', problem);
      }
      plan.push({ svc, providerId, isActive: r.isActive === undefined ? undefined : !!r.isActive });
    }
    const changes = [];
    await db.transaction(async (trx) => {
      for (const p of plan) {
        /* eslint-disable no-await-in-loop */
        const before = await trx('service_routes').where({ service_id: p.svc.id }).first('provider_id');
        const was = before ? before.provider_id : null;
        if (p.providerId !== undefined && was !== p.providerId) {
          if (p.providerId) {
            await trx('service_routes').insert({ service_id: p.svc.id, provider_id: p.providerId, updated_by: req.user.id, updated_at: trx.fn.now() })
              .onConflict('service_id').merge(['provider_id', 'updated_by', 'updated_at']);
          } else {
            await trx('service_routes').where({ service_id: p.svc.id }).del();
          }
          changes.push({ serviceId: p.svc.id, from: was, to: p.providerId });
        }
        if (p.isActive !== undefined && p.isActive !== !!p.svc.is_active) {
          await trx('services').where({ id: p.svc.id }).update({ is_active: p.isActive, updated_at: trx.fn.now() });
          changes.push({ serviceId: p.svc.id, isActive: p.isActive });
        }
        /* eslint-enable no-await-in-loop */
      }
    });
    if (changes.length) await log(req, 'product_switch_saved', { changes });
    return res.json({ ok: true, changed: changes.length });
  } catch (e) { return send(e, res, next); }
}

// ── Customer Switch ───────────────────────────────────────────────
const managedUser = (id) => db('users as u').leftJoin('user_types as t', 't.id', 'u.user_type_id')
  .where('u.id', id).whereNotNull('u.user_type_id').first('u.id', 'u.user_code', 'u.username', 'u.full_name', 'u.mobile', 't.name as user_type_name');

// Users who have their own API for a service, or a service allowed / blocked just for them.
async function customerSwitchList(req, res, next) {
  try {
    const p = pageOf(req.query); const q = clean(req.query.q);
    const base = db('users as u').leftJoin('user_types as t', 't.id', 'u.user_type_id').whereNotNull('u.user_type_id')
      .where((w) => w.whereExists(db('user_service_routes as r').whereRaw('r.user_id = u.id'))
        .orWhereExists(db('user_service_overrides as o').whereRaw('o.user_id = u.id')));
    if (q) base.where((w) => w.whereILike('u.user_code', `%${q}%`).orWhereILike('u.full_name', `%${q}%`).orWhereILike('u.mobile', `%${q}%`));
    const countRow = await base.clone().count('u.id as c').first();
    const rows = await base.clone().select('u.id', 'u.user_code', 'u.full_name', 't.name as user_type_name',
      db.raw('(select count(*)::int from user_service_routes r where r.user_id = u.id) as api_overrides'),
      db.raw('(select count(*)::int from user_service_overrides o where o.user_id = u.id and o.allowed = false) as blocked'),
      db.raw('(select count(*)::int from user_service_overrides o where o.user_id = u.id and o.allowed = true) as extra_allowed'),
      db.raw('greatest((select max(updated_at) from user_service_routes r where r.user_id = u.id), (select max(updated_at) from user_service_overrides o where o.user_id = u.id)) as updated_at'))
      .orderBy('updated_at', 'desc').limit(p.pageSize).offset((p.page - 1) * p.pageSize);
    return res.json({ rows, total: Number(countRow.c), ...p });
  } catch (e) { return next(e); }
}

async function customerSwitchGet(req, res, next) {
  try {
    const user = await managedUser(parseInt(req.params.userId, 10));
    if (!user) return bad(res, 'NOT_FOUND', 'User not found', 404);
    const ctx = await readiness();
    const perms = (await permission.servicesFor(user.id)).filter((s) => s.is_active);
    const own = new Map((await db('user_service_routes').where({ user_id: user.id }).select('service_id', 'provider_id')).map((r) => [r.service_id, r.provider_id]));
    const svcRoute = new Map((await db('service_routes').select('service_id', 'provider_id')).map((r) => [r.service_id, r.provider_id]));
    const cats = new Map((await db('services as s').leftJoin('service_categories as c', 'c.id', 's.service_category_id').select('s.id', 'c.name')).map((r) => [r.id, r.name]));
    const nameOf = (id) => (ctx.providers.find((p) => p.id === id) || {}).name || null;
    const rows = perms.map((s) => {
      const defaultId = svcRoute.get(s.id) || (ctx.mock ? ctx.mock.id : null);
      return {
        service_id: s.id, title: s.title, category_name: cats.get(s.id) || null,
        enabled: !!(s.override ?? s.type_default), type_default: s.type_default, override: s.override,
        provider_id: own.get(s.id) || null, default_provider_id: defaultId, default_provider_name: nameOf(defaultId),
        ready_provider_ids: ctx.providers.filter((p) => ctx.ready(p, s.id)).map((p) => p.id),
      };
    });
    return res.json({ user, rows, providers: ctx.providers });
  } catch (e) { return next(e); }
}

// PUT /customer-switch/:userId { rows: [{ serviceId, providerId (null = Product Switch API), enabled }] }
async function customerSwitchSave(req, res, next) {
  try {
    const user = await managedUser(parseInt(req.params.userId, 10));
    if (!user) return bad(res, 'NOT_FOUND', 'User not found', 404);
    const list = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!list.length || list.length > 500) return bad(res, 'INVALID_ROWS', 'Nothing to save');
    const ctx = await readiness();
    const perms = new Map((await permission.servicesFor(user.id)).map((s) => [s.id, s]));
    const plan = [];
    for (const r of list) {
      const s = perms.get(parseInt(r.serviceId, 10));
      if (!s) return bad(res, 'NOT_FOUND', 'Service not found', 404);
      // providerId left out = API unchanged; null = back to the Product Switch API.
      const providerId = r.providerId === undefined ? undefined : (r.providerId ? parseInt(r.providerId, 10) : null);
      if (providerId) {
        // eslint-disable-next-line no-await-in-loop
        const problem = await checkProvider(ctx, providerId, s.id, s.title);
        if (problem) return bad(res, 'PROVIDER_NOT_READY', problem);
      }
      plan.push({ s, providerId, enabled: r.enabled === undefined ? undefined : !!r.enabled });
    }
    const changes = [];
    await db.transaction(async (trx) => {
      for (const p of plan) {
        /* eslint-disable no-await-in-loop */
        const before = await trx('user_service_routes').where({ user_id: user.id, service_id: p.s.id }).first('provider_id');
        const was = before ? before.provider_id : null;
        if (p.providerId !== undefined && was !== p.providerId) {
          if (p.providerId) {
            await trx('user_service_routes').insert({ user_id: user.id, service_id: p.s.id, provider_id: p.providerId, updated_by: req.user.id, updated_at: trx.fn.now() })
              .onConflict(['user_id', 'service_id']).merge(['provider_id', 'updated_by', 'updated_at']);
          } else {
            await trx('user_service_routes').where({ user_id: user.id, service_id: p.s.id }).del();
          }
          changes.push({ serviceId: p.s.id, from: was, to: p.providerId });
        }
        // Allow / block lives in Service Permissions (user_service_overrides): store only what differs from the type default.
        const current = !!(p.s.override ?? p.s.type_default);
        if (p.enabled !== undefined && p.enabled !== current) {
          await permission.setOverrides(p.s.id, [user.id], p.enabled === p.s.type_default ? 'default' : (p.enabled ? 'allow' : 'block'), req.user.id, trx);
          changes.push({ serviceId: p.s.id, enabled: p.enabled });
        }
        /* eslint-enable no-await-in-loop */
      }
    });
    if (changes.length) await log(req, 'customer_switch_saved', { targetUserId: user.id, changes });
    return res.json({ ok: true, changed: changes.length });
  } catch (e) { return send(e, res, next); }
}

module.exports = {
  listProviders, providerOptions, createProvider, updateProvider, removeProvider, testProvider,
  spKeyServices, getSpKeys, saveSpKeys,
  productSwitch, saveProductSwitch,
  customerSwitchList, customerSwitchGet, customerSwitchSave,
  COMMISSION_TYPES,
};
