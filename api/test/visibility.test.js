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

  // A type that has a Parent Type keeps the parent that was picked, if that parent's type is above it.
  const [top2] = await db('users').insert({
    username: `${TAG}t2`, user_code: `${TAG}t2`, password_hash: 'x', mobile: '9000000003', full_name: 'Vis Top 2', role: 'user',
    user_type_id: topType.id, wallet_balance: 0, kyc_status: 'verified', parent_id: admin.id,
  }).returning(['id']);
  created.push(top2.id);
  const wrong = await A.put(`/api/users/${c.b.row.id}`, { userTypeId: childType.id, parentId: other.id });
  assert.equal(wrong.s, 400, 'a Child cannot sit under another Child');
  assert.equal(wrong.b.code, 'PARENT_TYPE_MISMATCH');
  const m = await A.put(`/api/users/${c.b.row.id}`, { userTypeId: childType.id, parentId: top2.id });
  assert.equal(m.s, 200, JSON.stringify(m.b));
  assert.equal(m.b.row.parent_id, top2.id);
});

test('slot operator: dropdown choices, normalised, validated, cleared, audited', async () => {
  const mobile = await db('services').whereRaw("lower(title) = 'mobile recharge'").first('id');
  const opts = await A.get(`/api/commission-slots/operator-options?serviceId=${mobile.id}`);
  assert.equal(opts.s, 200);
  assert.equal(opts.b.kind, 'operator');
  assert.ok(opts.b.options.includes('Airtel'));
  const none = await A.get(`/api/commission-slots/operator-options?serviceId=${svc.id}`);
  assert.deepEqual(none.b, { kind: null, options: [] }, 'a service without operators has no choice');

  const body = { userTypeId: topType.id, serviceId: mobile.id, planId: plan.id, commissionType: 'percentage', minAmount: 1, maxAmount: 1000, value: 4, chainType: 'chain' };
  assert.equal((await A.post('/api/commission-slots', { ...body, operator: 'Airtel Prepaid' })).s, 400, 'typo refused');
  assert.equal((await A.post('/api/commission-slots', { ...body, serviceId: svc.id, operator: 'Airtel' })).s, 400, 'no operator for this service');
  const c = await A.post('/api/commission-slots', { ...body, operator: 'airtel' });
  assert.equal(c.s, 201, JSON.stringify(c.b));
  const { id } = c.b.row;
  try {
    assert.equal(c.b.row.operator, 'Airtel', 'stored with the master spelling');
    const u = await A.put(`/api/commission-slots/${id}`, { ...body, operator: '' });
    assert.equal(u.s, 200, JSON.stringify(u.b));
    assert.equal(u.b.row.operator, null, 'empty = all operators');
    assert.equal((await A.del(`/api/commission-slots/${id}`)).s, 200);
    const events = (await db('audit_log').whereIn('event', ['commission_slot_created', 'commission_slot_updated', 'commission_slot_deleted'])
      .whereRaw("coalesce(detail->'after'->>'id', detail->'before'->>'id') = ?", [String(id)]).select('event')).map((r) => r.event).sort();
    assert.deepEqual(events, ['commission_slot_created', 'commission_slot_deleted', 'commission_slot_updated']);
  } finally {
    await db('commission_slots').where({ id }).del();
    await db('audit_log').where('event', 'like', 'commission_slot_%').whereRaw("coalesce(detail->'after'->>'id', detail->'before'->>'id') = ?", [String(id)]).del();
  }
});

test('service list filters by category and returns per-category counts', async () => {
  const cat = await db('services').where({ id: svc.id }).first('service_category_id');
  const r = await A.get(`/api/services?categoryId=${cat.service_category_id}&withCounts=1&pageSize=100`);
  assert.equal(r.s, 200);
  assert.ok(r.b.rows.length && r.b.rows.every((x) => x.service_category_id === cat.service_category_id), 'only that category');
  assert.ok(r.b.rows.some((x) => x.id === svc.id));
  const c = r.b.categoryCounts.find((x) => x.categoryId === cat.service_category_id);
  assert.equal(c.count, r.b.total, 'chip count matches the filtered total');
  assert.equal((await A.get('/api/services?pageSize=5')).b.categoryCounts, undefined, 'counts only when asked');
});
