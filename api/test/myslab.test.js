'use strict';

// "My Commission Slab" (a managed user's own read-only list) shows only what really applies to HIM: switched-on slabs of his plan, the
// type's generic ones plus the ones written for him - never another user's - and his own slab instead of the generic one it covers.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor } = require('./helper');

const PORT = 3900;
const BASE = `http://localhost:${PORT}`;
const TAG = `ms${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let typeId; let planA; let planB; let svcId; let catId; let X; let Y; let Z; let W;
const slots = []; const users = [];

const mkSlot = async (planId, o) => {
  const id = idOf((await db('commission_slots').insert({
    user_type_id: typeId, service_id: svcId, plan_id: planId, operator: '', commission_type: 'percentage', min_amount: 1, max_amount: 1000,
    value: 0, chain_type: 'chain', txn_type: 'credit', is_active: true, ...o,
  }).returning('id'))[0]);
  slots.push(id); return id;
};
const mkUser = async (key, planId) => {
  const id = idOf((await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000', full_name: `MS ${key}`,
    role: 'user', user_type_id: typeId, plan_id: planId, kyc_status: 'verified',
  }).returning('id'))[0]);
  users.push(id); return id;
};
const mine = async (id) => {
  const r = await api(BASE, signFor(await db('users').where({ id }).first())).get('/api/retailer/my-commission-slab?pageSize=100');
  assert.equal(r.s, 200, JSON.stringify(r.b));
  return r.b.rows.filter((x) => x.service_id === svcId).map((x) => `${x.operator || 'all'} ${Number(x.value)} ${x.txn_type} ${Number(x.min_amount)}-${Number(x.max_amount)}${x.specific_user ? ' own' : ''}`).sort();
};

before(async () => {
  server = await startServer(PORT);
  catId = (await db('service_categories').orderBy('id').first('id')).id;
  typeId = idOf((await db('user_types').insert({ name: `${TAG} Retailer` }).returning('id'))[0]);
  planA = idOf((await db('plans').insert({ user_type_id: typeId, name: `${TAG} A` }).returning('id'))[0]);
  planB = idOf((await db('plans').insert({ user_type_id: typeId, name: `${TAG} B` }).returning('id'))[0]);
  svcId = idOf((await db('services').insert({ title: `${TAG} Recharge`, code: `${TAG}-rc`, service_category_id: catId, is_active: true }).returning('id'))[0]);
  X = await mkUser('x', planA); Y = await mkUser('y', planA); Z = await mkUser('z', planA); W = await mkUser('w', null);
  await mkSlot(planA, { operator: 'Jio', value: 0.3 });                                   // everyone on plan A
  await mkSlot(planB, { operator: 'Jio', value: 0.5 });                                   // another plan
  await mkSlot(planA, { operator: 'Jio', value: 0.4, specific_user: `${TAG}x` });         // written for X, covers the generic Jio slab
  await mkSlot(planA, { operator: 'Jio', value: 0.9, specific_user: `${TAG}y` });         // written for Y
  await mkSlot(planA, { operator: 'Airtel', value: 1.0, is_active: false });             // switched off
  await mkSlot(planA, { operator: 'Airtel', value: 1.1 });                                // generic Airtel
  await mkSlot(planA, { operator: 'Airtel', value: 0.2, specific_user: `${TAG}x`, max_amount: 500 }); // X's own, but only part of the range
  await mkSlot(planA, { value: 5, commission_type: 'amount', txn_type: 'debit', chain_type: 'self' });  // a service charge
});

after(async () => {
  await db('commission_slots').whereIn('id', slots).del();
  await db('users').whereIn('id', users).del();
  await db('services').where({ id: svcId }).del();
  await db('plans').whereIn('id', [planA, planB]).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('a user sees his own slab instead of the generic one it covers, and never another user\'s slab', async () => {
  const x = await mine(X);
  assert.ok(x.includes('Jio 0.4 credit 1-1000 own'), x.join(' | '));
  assert.ok(!x.includes('Jio 0.3 credit 1-1000'), 'the generic Jio slab is hidden: his own one applies');
  assert.ok(!x.some((r) => r.includes('0.9')), 'Y\'s own slab is not shown to X');
  const y = await mine(Y);
  assert.ok(y.includes('Jio 0.9 credit 1-1000 own')); assert.ok(!y.includes('Jio 0.3 credit 1-1000')); assert.ok(!y.some((r) => r.includes('Jio 0.4')), 'X\'s own slab is not shown to Y');
});

test('a user with no slab of his own sees the generic ones only', async () => {
  const z = await mine(Z);
  assert.ok(z.includes('Jio 0.3 credit 1-1000')); assert.ok(!z.some((r) => r.includes(' own')), 'no other user\'s slab');
  assert.ok(!z.some((r) => r.includes('Jio 0.4')) && !z.some((r) => r.includes('Jio 0.9')));
});

test('only slabs of his own plan and that are switched on; a user without a plan matches any plan (like the engine)', async () => {
  const z = await mine(Z);
  assert.ok(!z.some((r) => r.includes('Jio 0.5')), 'plan B slab is not shown to a plan A user');
  assert.ok(!z.some((r) => r.includes('Airtel 1 ')), 'the switched-off slab is not shown');
  assert.ok(z.includes('Airtel 1.1 credit 1-1000'));
  const w = await mine(W);
  assert.ok(w.includes('Jio 0.3 credit 1-1000') && w.includes('Jio 0.5 credit 1-1000'), 'no plan = every plan\'s generic slabs');
});

test('his own slab that covers only part of the range is shown next to the generic one (both apply, each in its range)', async () => {
  const x = await mine(X);
  assert.ok(x.includes('Airtel 1.1 credit 1-1000') && x.includes('Airtel 0.2 credit 1-500 own'), x.join(' | '));
});

test('service charges (debit slabs) of his plan are still listed', async () => {
  assert.ok((await mine(Z)).includes('all 5 debit 1-1000'));
});

test('the admin\'s own Commission Slab report is unchanged: it lists every slab of the type, other users\' and switched-off ones too', async () => {
  const { adminUser } = require('./helper');
  const r = await api(BASE, signFor(await adminUser())).get('/api/commission-slab?pageSize=100');
  const mineRows = (r.b.rows || []).filter((x) => x.service_id === svcId);
  assert.ok(mineRows.length >= 8, `${mineRows.length} rows`);
});
