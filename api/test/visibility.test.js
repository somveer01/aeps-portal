'use strict';

// Switched-off services stay out of dropdowns and the retailer's slab list, and a user of a
// top-level account type (no Parent Type, e.g. Super Distributor) always sits under the admin.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3910;
const BASE = `http://localhost:${PORT}`;
const TAG = `vis${Date.now()}`;
let server; let admin; let A; let svc; let topType; let childType; let plan; let other;
const created = [];

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  A = api(BASE, signFor(admin));
  const cat = await db('service_categories').orderBy('id').first('id');
  [svc] = await db('services').insert({ title: `${TAG} Service`, service_category_id: cat.id, is_active: false }).returning(['id', 'title']);
  [topType] = await db('user_types').insert({ name: `${TAG} Top`, is_active: true, parent_type_id: null }).returning(['id']);
  [childType] = await db('user_types').insert({ name: `${TAG} Child`, is_active: true, parent_type_id: topType.id }).returning(['id']);
  [plan] = await db('plans').insert({ user_type_id: topType.id, name: `${TAG} Plan` }).returning(['id']);
  await db('commission_slots').insert({
    user_type_id: topType.id, service_id: svc.id, plan_id: plan.id, commission_type: 'percentage', min_amount: 1, max_amount: 1000, value: 1, chain_type: 'self',
  });
  [other] = await db('users').insert({
    username: TAG, user_code: TAG, password_hash: 'x', mobile: '9000000001', full_name: 'Vis Other', role: 'user',
    user_type_id: childType.id, wallet_balance: 0, kyc_status: 'verified', parent_id: admin.id,
  }).returning(['id', 'username', 'role', 'token_epoch']);
  created.push(other.id);
});

after(async () => {
  await db('commission_slots').where({ service_id: svc.id }).del();
  await db('users').whereIn('id', created).del();
  await db('plans').where({ id: plan.id }).del();
  await db('user_types').whereIn('id', [childType.id, topType.id]).del();
  await db('services').where({ id: svc.id }).del();
  server.close();
  await db.destroy();
});

test('?active=1 leaves switched-off services out; Service Master still lists them', async () => {
  const q = encodeURIComponent(TAG);
  const all = await A.get(`/api/services?q=${q}&pageSize=100`);
  assert.equal(all.s, 200);
  assert.ok(all.b.rows.some((r) => r.id === svc.id));
  const active = await A.get(`/api/services?q=${q}&pageSize=100&active=1`);
  assert.equal(active.s, 200);
  assert.ok(!active.b.rows.some((r) => r.id === svc.id));
});

test("retailer's commission slab list hides switched-off services", async () => {
  const R = api(BASE, signFor(await db('users').where({ id: other.id }).first()));
  await db('users').where({ id: other.id }).update({ user_type_id: topType.id });
  try {
    const off = await R.get('/api/retailer/my-commission-slab?pageSize=100');
    assert.equal(off.s, 200);
    assert.equal(off.b.rows.length, 0);
    await db('services').where({ id: svc.id }).update({ is_active: true });
    await db('user_service_overrides').insert({ user_id: other.id, service_id: svc.id, allowed: true }); // the user may use it
    const on = await R.get('/api/retailer/my-commission-slab?pageSize=100');
    assert.equal(on.b.rows.length, 1);
  } finally {
    await db('services').where({ id: svc.id }).update({ is_active: false });
    await db('users').where({ id: other.id }).update({ user_type_id: childType.id, parent_id: admin.id });
  }
});

test('a top-level account type is always placed under the admin', async () => {
  const body = { name: 'Vis Top', mobile: '9000000002', password: 'Secret@123', userTypeId: topType.id, parentId: other.id };
  const c = await A.post('/api/users', body);
  assert.equal(c.s, 201, JSON.stringify(c.b));
  created.push(c.b.row.id);
  assert.equal(c.b.row.parent_id, admin.id, 'parent picked in the form is ignored');

  const u = await A.put(`/api/users/${c.b.row.id}`, { parentId: other.id });
  assert.equal(u.s, 200);
  assert.equal(u.b.row.parent_id, admin.id, 'cannot be moved under another user');

  // A type that has a Parent Type keeps the parent that was picked.
  const m = await A.put(`/api/users/${c.b.row.id}`, { userTypeId: childType.id, parentId: other.id });
  assert.equal(m.s, 200);
  assert.equal(m.b.row.parent_id, other.id);
});
