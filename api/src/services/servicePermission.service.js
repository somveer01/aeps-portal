'use strict';

const db = require('../config/db');

/**
 * Who may use which service (single source of truth):
 *   can(user, service) = service.is_active AND coalesce(user override, user type default)
 * Type defaults live in user_type_services (row = allowed); per-user allow / block in
 * user_service_overrides. Only the admin changes either.
 */

// Effective permission of every service for one user: [{ id, title, is_active, type_default, override, allowed }].
async function servicesFor(userId, trx = db) {
  const user = await trx('users').where({ id: userId }).first('id', 'user_type_id');
  if (!user) return [];
  const rows = await trx('services as s')
    .leftJoin('user_type_services as t', (j) => j.on('t.service_id', 's.id').andOn('t.user_type_id', trx.raw('?', [user.user_type_id || 0])))
    .leftJoin('user_service_overrides as o', (j) => j.on('o.service_id', 's.id').andOn('o.user_id', trx.raw('?', [user.id])))
    .orderBy('s.id')
    .select('s.id', 's.title', 's.is_active', trx.raw('(t.service_id is not null) as type_default'), 'o.allowed as override');
  return rows.map((r) => {
    const typeDefault = !!r.type_default;
    const override = r.override === null || r.override === undefined ? null : !!r.override;
    return { id: r.id, title: r.title, is_active: !!r.is_active, type_default: typeDefault, override, allowed: !!r.is_active && (override ?? typeDefault) };
  });
}

/** Set of service ids the user can use right now. */
async function allowedServiceIds(userId, trx = db) {
  return new Set((await servicesFor(userId, trx)).filter((s) => s.allowed).map((s) => s.id));
}

/** Can the user use this service row ({ id, is_active })? */
async function can(userId, svc, trx = db) {
  if (!svc || !svc.is_active) return false;
  const user = await trx('users').where({ id: userId }).first('user_type_id');
  if (!user) return false;
  const o = await trx('user_service_overrides').where({ user_id: userId, service_id: svc.id }).first('allowed');
  if (o) return !!o.allowed;
  return !!(user.user_type_id && await trx('user_type_services').where({ user_type_id: user.user_type_id, service_id: svc.id }).first('service_id'));
}

/** Allow or deny a service for user types. `typeIds` / `serviceIds` may hold many ids (bulk). */
async function setTypeServices(typeIds, serviceIds, allowed, by, trx = db) {
  if (!typeIds.length || !serviceIds.length) return;
  if (!allowed) {
    await trx('user_type_services').whereIn('user_type_id', typeIds).whereIn('service_id', serviceIds).del();
    return;
  }
  const rows = [];
  typeIds.forEach((t) => serviceIds.forEach((s) => rows.push({ user_type_id: t, service_id: s, updated_by: by, updated_at: trx.fn.now() })));
  await trx('user_type_services').insert(rows).onConflict(['user_type_id', 'service_id']).merge(['updated_by', 'updated_at']);
}

/** mode 'allow' | 'block' writes an override for each user; 'default' removes it (back to the type default). */
async function setOverrides(serviceId, userIds, mode, by, trx = db) {
  if (!userIds.length) return;
  if (mode === 'default') {
    await trx('user_service_overrides').where({ service_id: serviceId }).whereIn('user_id', userIds).del();
    return;
  }
  const allowed = mode === 'allow';
  await trx('user_service_overrides')
    .insert(userIds.map((u) => ({ user_id: u, service_id: serviceId, allowed, updated_by: by, updated_at: trx.fn.now() })))
    .onConflict(['user_id', 'service_id']).merge(['allowed', 'updated_by', 'updated_at']);
}

/**
 * Users Manager form: `wanted` = the service ids ticked for this user. Store only what differs
 * from the type default, so a later change of the type default still reaches this user.
 */
async function setUserServices(userId, wanted, by, trx = db) {
  const want = new Set((wanted || []).map(Number));
  // The form lists only switched-on services, so overrides of switched-off ones are left as they are.
  const current = (await servicesFor(userId, trx)).filter((s) => s.is_active);
  if (!current.length) return;
  await trx('user_service_overrides').where({ user_id: userId }).whereIn('service_id', current.map((s) => s.id)).del();
  const rows = current
    .filter((s) => want.has(s.id) !== s.type_default)
    .map((s) => ({ user_id: userId, service_id: s.id, allowed: want.has(s.id), updated_by: by, updated_at: trx.fn.now() }));
  if (rows.length) await trx('user_service_overrides').insert(rows);
}

/** Ids the user would get with the form's checkboxes (type default + overrides, ignoring Service Master on/off). */
async function tickedServiceIds(userId, trx = db) {
  return (await servicesFor(userId, trx)).filter((s) => (s.override ?? s.type_default)).map((s) => s.id);
}

module.exports = { servicesFor, allowedServiceIds, can, setTypeServices, setOverrides, setUserServices, tickedServiceIds };
