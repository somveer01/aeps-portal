'use strict';

// Service Permissions: Service Master ON/OFF, user-type defaults, per-user allow/block,
// the admin endpoints (matrix + service-wise), the sidebar menu and the Users Manager form.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');
const permission = require('../src/services/servicePermission.service');

const PORT = 3920;
const BASE = `http://localhost:${PORT}`;
const TAG = `prm${Date.now()}`;
let server; let admin; let A; let svcA; let svcB; let type; let userId; let userTok;
const created = [];

const svcRow = (id) => db('services').where({ id }).first('id', 'is_active');
const can = async (sid) => permission.can(userId, await svcRow(sid));

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  A = api(BASE, signFor(admin));
  const cat = await db('service_categories').orderBy('id').first('id');
  [svcA] = await db('services').insert({ title: `${TAG} A`, service_category_id: cat.id, is_active: true }).returning(['id']);
  [svcB] = await db('services').insert({ title: `${TAG} B`, service_category_id: cat.id, is_active: true }).returning(['id']);
  [type] = await db('user_types').insert({ name: `${TAG} Type`, is_active: true }).returning(['id']);
  const [u] = await db('users').insert({
    username: TAG, user_code: TAG, password_hash: 'x', mobile: '9000000003', full_name: 'Perm Test', role: 'user',
    user_type_id: type.id, wallet_balance: 0, kyc_status: 'verified', parent_id: admin.id,
  }).returning(['id']);
  userId = u.id;
  created.push(userId);
  userTok = signFor(await db('users').where({ id: userId }).first());
});

after(async () => {
  await db('audit_log').where({ event: 'service_permission_changed' }).whereRaw("detail->>'serviceId' in (?, ?)", [String(svcA.id), String(svcB.id)]).del();
  await db('users').whereIn('id', created).del();
  await db('user_types').where({ id: type.id }).del();
  await db('services').whereIn('id', [svcA.id, svcB.id]).del();
  server.close();
  await db.destroy();
});

test('type default, user override and Service Master OFF decide access', async () => {
  assert.equal(await can(svcA.id), false, 'new type allows nothing');
  await permission.setTypeServices([type.id], [svcA.id], true, admin.id);
  assert.equal(await can(svcA.id), true, 'type default allows');
  await permission.setOverrides(svcA.id, [userId], 'block', admin.id);
  assert.equal(await can(svcA.id), false, 'user block beats type allow');
  await permission.setOverrides(svcB.id, [userId], 'allow', admin.id);
  assert.equal(await can(svcB.id), true, 'user allow beats type deny');
  await db('services').where({ id: svcB.id }).update({ is_active: false });
  assert.equal(await can(svcB.id), false, 'Service Master OFF beats everything');
  await db('services').where({ id: svcB.id }).update({ is_active: true });
  await permission.setOverrides(svcA.id, [userId], 'default', admin.id);
  assert.equal(await can(svcA.id), true, 'back to the type default');
  const ids = await permission.allowedServiceIds(userId);
  assert.ok(ids.has(svcA.id) && ids.has(svcB.id));
});

test('matrix endpoints: admin edits a cell, a whole service, a whole type', async () => {
  const m = await A.get('/api/service-permissions/matrix');
  assert.equal(m.s, 200);
  assert.ok(m.b.allowed.some((a) => a.userTypeId === type.id && a.serviceId === svcA.id));

  assert.equal((await A.put('/api/service-permissions/matrix', { userTypeId: type.id, serviceId: svcA.id, allowed: false })).s, 200);
  assert.ok(!(await db('user_type_services').where({ user_type_id: type.id, service_id: svcA.id }).first()));

  assert.equal((await A.put('/api/service-permissions/matrix', { userTypeId: type.id, allowed: true })).s, 200, 'all services for the type');
  const n = await db('user_type_services').where({ user_type_id: type.id }).count('* as c').first();
  assert.equal(Number(n.c), Number((await db('services').count('* as c').first()).c));

  assert.equal((await A.put('/api/service-permissions/matrix', { serviceId: svcB.id, allowed: false })).s, 200, 'service off for every type');
  assert.ok(!(await db('user_type_services').where({ service_id: svcB.id }).first()));
  await A.put('/api/service-permissions/matrix', { userTypeId: type.id, allowed: false });

  assert.equal((await A.put('/api/service-permissions/matrix', { userTypeId: type.id })).s, 400, 'allowed is required');
  assert.ok(await db('audit_log').where({ event: 'service_permission_changed', user_id: admin.id }).first(), 'audited');
});

test('service-wise users endpoint lists and bulk-sets allow / block / default', async () => {
  const list = await A.get(`/api/service-permissions/services/${svcA.id}/users?q=${TAG}`);
  assert.equal(list.s, 200);
  const row = list.b.rows.find((r) => r.id === userId);
  assert.ok(row);
  assert.equal(row.type_default, false);
  assert.equal(row.effective, false);

  assert.equal((await A.put(`/api/service-permissions/services/${svcA.id}/users`, { userIds: [userId], mode: 'allow' })).s, 200);
  const allowed = await A.get(`/api/service-permissions/services/${svcA.id}/users?q=${TAG}&status=allowed`);
  assert.ok(allowed.b.rows.some((r) => r.id === userId && r.override === true && r.effective === true));

  assert.equal((await A.put(`/api/service-permissions/services/${svcA.id}/users`, { userIds: [userId], mode: 'default' })).s, 200);
  const blocked = await A.get(`/api/service-permissions/services/${svcA.id}/users?q=${TAG}&status=blocked`);
  assert.ok(blocked.b.rows.some((r) => r.id === userId && r.override === null));

  assert.equal((await A.put(`/api/service-permissions/services/${svcA.id}/users`, { userIds: [admin.id], mode: 'allow' })).s, 400, 'admin is not a portal user');
  assert.equal((await A.put(`/api/service-permissions/services/${svcA.id}/users`, { userIds: [userId], mode: 'maybe' })).s, 400);
});

test('only the admin can manage permissions', async () => {
  const U = api(BASE, userTok);
  assert.equal((await U.get('/api/service-permissions/matrix')).s, 403);
  assert.equal((await U.put(`/api/service-permissions/services/${svcA.id}/users`, { userIds: [userId], mode: 'allow' })).s, 403);
});

test('sidebar drops Services when the user may use nothing', async () => {
  const U = api(BASE, userTok);
  await db('user_service_overrides').where({ user_id: userId }).del();
  await db('user_type_services').where({ user_type_id: type.id }).del();
  const routes = (nodes) => nodes.flatMap((n) => [n.route, ...routes(n.children || [])]);
  const none = await U.get('/api/menu');
  assert.equal(none.s, 200);
  assert.ok(!routes(none.b.menu).includes('/services'));
  await permission.setOverrides(svcA.id, [userId], 'allow', admin.id);
  const some = await U.get('/api/menu');
  assert.ok(routes(some.b.menu).includes('/services'));
  await db('user_service_overrides').where({ user_id: userId }).del();
});

test('Users Manager form saves only the difference from the type default', async () => {
  await permission.setTypeServices([type.id], [svcA.id], true, admin.id);
  const u = await A.put(`/api/users/${userId}`, { serviceAccess: [svcB.id] }); // untick A, tick B
  assert.equal(u.s, 200, JSON.stringify(u.b));
  const o = await db('user_service_overrides').where({ user_id: userId }).whereIn('service_id', [svcA.id, svcB.id]).orderBy('service_id').select('service_id', 'allowed');
  assert.deepEqual(o.map((r) => [r.service_id, r.allowed]), [[svcA.id, false], [svcB.id, true]]);
  assert.ok(u.b.row.service_access.includes(svcB.id) && !u.b.row.service_access.includes(svcA.id), 'form gets the effective ticks');

  // Ticking exactly the type default leaves no overrides behind.
  const typeDefault = (await db('user_type_services').where({ user_type_id: type.id }).select('service_id')).map((r) => r.service_id);
  await A.put(`/api/users/${userId}`, { serviceAccess: typeDefault });
  assert.equal(Number((await db('user_service_overrides').where({ user_id: userId }).count('* as c').first()).c), 0);

  // A switched-off service is not in the form, so saving keeps its override untouched.
  await permission.setOverrides(svcB.id, [userId], 'allow', admin.id);
  await db('services').where({ id: svcB.id }).update({ is_active: false });
  await A.put(`/api/users/${userId}`, { serviceAccess: typeDefault });
  assert.ok(await db('user_service_overrides').where({ user_id: userId, service_id: svcB.id, allowed: true }).first());
  await db('services').where({ id: svcB.id }).update({ is_active: true });
});
