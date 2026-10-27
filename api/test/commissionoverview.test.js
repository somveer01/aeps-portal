'use strict';

// Commission Overview (admin, read only): provider commission, what each level of a sale chain is paid (commission + GST) and the
// company's margin, per service and operator. Numbers are worked out by hand here and must match what the engine would pay.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');

const PORT = 3898;
const BASE = `http://localhost:${PORT}`;
const TAG = `co${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
const { findSlab, selectSlab } = require('../src/services/commission.service');
let server; let A; let retailerToken; let catId; let sd; let d; let r; let planSd; let planD; let planR; let svcId; let mockId; let userId; let productId = null;
const slots = []; const extraUsers = []; let pkgId = null; let uSd; let uD; let uR;

const mkSlot = async (typeId, planId, o) => {
  const id = idOf((await db('commission_slots').insert({
    user_type_id: typeId, service_id: svcId, plan_id: planId, operator: '', commission_type: 'percentage', min_amount: 1, max_amount: 100000,
    value: 0, chain_type: 'chain', txn_type: 'credit', is_active: true, ...o,
  }).returning('id'))[0]);
  slots.push(id); return id;
};
const get = (q = '') => A.get(`/api/commission-overview?typeId=${r}&plans=${sd}:${planSd},${d}:${planD},${r}:${planR}&${q}`);
const rowOf = (b, operator = '') => b.services.find((s) => s.serviceId === svcId).rows.find((x) => x.operator === operator);

before(async () => {
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  catId = (await db('service_categories').orderBy('id').first('id')).id;
  sd = idOf((await db('user_types').insert({ name: `${TAG} SD` }).returning('id'))[0]);
  d = idOf((await db('user_types').insert({ name: `${TAG} D`, parent_type_id: sd }).returning('id'))[0]);
  r = idOf((await db('user_types').insert({ name: `${TAG} R`, parent_type_id: d }).returning('id'))[0]);
  planSd = idOf((await db('plans').insert({ user_type_id: sd, name: `${TAG} SDplan` }).returning('id'))[0]);
  planD = idOf((await db('plans').insert({ user_type_id: d, name: `${TAG} Dplan` }).returning('id'))[0]);
  planR = idOf((await db('plans').insert({ user_type_id: r, name: `${TAG} Rplan` }).returning('id'))[0]);
  // A Mobile Recharge-style service: provider pays 3% (Service Master rate), operators from the mobile list.
  svcId = idOf((await db('services').insert({
    title: `${TAG} Recharge`, code: `${TAG}-rc`, screen: 'mobile-recharge', service_category_id: catId, is_active: true,
    provider_commission_type: 'percentage', provider_commission_value: 3,
  }).returning('id'))[0]);
  mockId = (await db('api_providers').where({ code: 'MOCK' }).first('id')).id;
  // Retailer 2% (self), Distributor 0.5% (chain), Super Distributor 0.25% (chain); a Jio-only retailer slab of 1%.
  await mkSlot(r, planR, { value: 2, chain_type: 'self' });
  await mkSlot(d, planD, { value: 0.5 });
  await mkSlot(sd, planSd, { value: 0.25 });
  await mkSlot(r, planR, { value: 1, chain_type: 'self', operator: 'Jio' });
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Overview', role: 'user', user_type_id: r, kyc_status: 'verified',
  }).returning('id'))[0]);
  retailerToken = signFor(await db('users').where({ id: userId }).first());
});

after(async () => {
  if (pkgId) { await db('commission_package_items').where({ package_id: pkgId }).del(); await db('commission_packages').where({ id: pkgId }).del(); }
  if (productId) await db('provider_products').where({ id: productId }).del();
  await db('commission_slots').whereIn('id', slots).del();
  await db('users').where({ id: userId }).del();
  for (const u of [...extraUsers].reverse()) await db('users').where({ id: u }).del();
  await db('services').where({ id: svcId }).del();
  await db('plans').whereIn('id', [planSd, planD, planR]).del();
  await db('user_types').whereIn('id', [r, d, sd]).del();
  server.close();
  await db.destroy();
});

test('only the admin may read it', async () => {
  assert.equal((await api(BASE, retailerToken).get('/api/commission-overview')).s, 403);
  assert.equal((await api(BASE, '').get('/api/commission-overview')).s, 401);
});

test('the chain is the sale type and every type above it, top first, each with its plans', async () => {
  const b = (await get()).b;
  assert.equal(b.amount, 1000); assert.equal(b.bottomTypeId, r);
  assert.deepEqual(b.chain.map((c) => c.typeId), [sd, d, r]);
  assert.deepEqual(b.chain.map((c) => c.planId), [planSd, planD, planR]);
  assert.deepEqual(b.chain[2].plans.map((p) => p.id), [planR]);
});

test('"all operators": provider 3% = 30; R 2% + GST = 23.60, D 0.5% + GST = 5.90, SD 0.25% + GST = 2.95; margin = 30 - 32.45', async () => {
  const x = rowOf((await get()).b);
  assert.equal(x.provider.amount, 30); assert.equal(x.provider.percent, 3); assert.equal(x.provider.source, 'service');
  assert.deepEqual(x.cells.map((c) => c.net), [2.95, 5.9, 23.6]);
  assert.deepEqual(x.cells.map((c) => c.commission), [2.5, 5, 20]);
  assert.equal(x.totalPaid, 32.45);
  assert.equal(x.margin, -2.45); assert.equal(x.marginPercent, -0.25); assert.equal(x.status, 'over', 'paying more than the API gives is flagged');
});

test('a smaller sample amount scales the same slabs (percent slabs): 500 -> provider 15, paid 16.23', async () => {
  const x = rowOf((await get('amount=500')).b);
  assert.equal(x.provider.amount, 15); assert.equal(x.totalPaid, 16.23);
});

test('an operator row uses its own slab and falls back to the all-operators slab; the fallback is marked inherited', async () => {
  const b = (await get()).b;
  const jio = rowOf(b, 'Jio'); const airtel = rowOf(b, 'Airtel');
  assert.ok(jio && airtel, 'the mobile operators are listed');
  assert.equal(jio.cells[2].value, 1); assert.equal(jio.cells[2].inherited, false); assert.equal(jio.cells[2].net, 11.8);
  assert.equal(airtel.cells[2].value, 2); assert.equal(airtel.cells[2].inherited, true);
  assert.equal(jio.cells[1].inherited, true, 'the distributor has no Jio slab, so the all-operators slab applies');
  assert.equal(jio.totalPaid, 20.65);
  assert.equal(jio.margin, 9.35); assert.equal(jio.status, 'ok');
});

test('an SP key for the service\'s API beats the Service Master rate, per operator (surcharge = negative)', async () => {
  productId = idOf((await db('provider_products').insert({ provider_id: mockId, service_id: svcId, operator: 'Jio', sp_key: '', commission_type: 'percent', commission_value: 1.5, is_active: true }).returning('id'))[0]);
  const jio = rowOf((await get()).b, 'Jio');
  assert.equal(jio.provider.source, 'sp_key'); assert.equal(jio.provider.amount, 15); assert.equal(jio.margin, -5.65);
  assert.equal(rowOf((await get()).b, 'Airtel').provider.source, 'service', 'other operators keep the Service Master rate');
  await db('provider_products').where({ id: productId }).update({ commission_type: 'surcharge', commission_value: 1 });
  assert.equal(rowOf((await get()).b, 'Jio').provider.amount, -1, 'a flat surcharge of Rs 1 is negative');
  await db('provider_products').where({ id: productId }).update({ commission_type: 'surcharge_percent', commission_value: 1 });
  assert.equal(rowOf((await get()).b, 'Jio').provider.amount, -10, 'a percent surcharge of 1% of 1000 is negative too');
});

test('an upper type without a chain slab earns nothing and the row says so (gap); a self slab on an upper type does not count', async () => {
  await db('commission_slots').where({ user_type_id: sd, service_id: svcId }).update({ chain_type: 'self' });
  const x = rowOf((await get()).b);
  assert.equal(x.cells[0].slotId, null); assert.equal(x.cells[0].others, 1, 'the self slab exists but is not used for an upline');
  assert.equal(x.totalPaid, 29.5);
  await db('commission_slots').where({ user_type_id: sd, service_id: svcId }).update({ chain_type: 'chain' });
});

test('a bad sample amount is refused', async () => {
  for (const v of ['abc', '-5', '0', '1e3', '99999999999']) assert.equal((await get(`amount=${v}`)).s, 400, v);
});

// ── by user ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const mkUser = async (key, typeId, planId, parentId, extra = {}) => {
  const id = idOf((await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000', full_name: `Chain ${key}`,
    role: 'user', user_type_id: typeId, plan_id: planId, parent_id: parentId, kyc_status: 'verified', ...extra,
  }).returning('id'))[0]);
  extraUsers.push(id); return id;
};
const byUser = (id, q = '') => A.get(`/api/commission-overview?userId=${id}&${q}`);

test('by user: the real chain above him (parent_id), each with his own plan, top first', async () => {
  uSd = await mkUser('sd', sd, planSd, null);
  uD = await mkUser('d', d, planD, uSd);
  uR = await mkUser('r', r, planR, uD);
  const b = (await byUser(uR)).b;
  assert.equal(b.mode, 'user'); assert.equal(b.user.id, uR); assert.equal(b.user.typeName, `${TAG} R`);
  assert.deepEqual(b.chain.map((c) => c.userId), [uSd, uD, uR]);
  assert.deepEqual(b.chain.map((c) => c.planId), [planSd, planD, planR]);
  const x = rowOf(b);
  assert.deepEqual(x.cells.map((c) => c.net), [2.95, 5.9, 23.6], 'with no user-specific slab it is the type slabs');
  assert.ok(x.cells.every((c) => c.scope === 'type'));
  assert.equal(x.margin, -2.45);
});

test('by user: a slab written for one user beats the type slab; it is marked scope user; the others stay on the type slab', async () => {
  await mkSlot(r, planR, { value: 1.5, chain_type: 'self', specific_user: `${TAG}r` });
  const x = rowOf((await byUser(uR)).b);
  assert.equal(x.cells[2].value, 1.5); assert.equal(x.cells[2].scope, 'user'); assert.equal(x.cells[2].specificUser, `${TAG}r`);
  assert.equal(x.cells[2].net, 17.7); assert.equal(x.cells[2].userSlabs, 1);
  assert.equal(x.cells[1].scope, 'type');
  assert.equal(x.totalPaid, 26.55); assert.equal(x.margin, 3.45);
  // by type the same slab is only counted, never applied
  const t = rowOf((await get()).b);
  assert.equal(t.cells[2].value, 2); assert.equal(t.cells[2].userSlabs, 1);
});

test('by user: what he earns on his downline\'s sales (his chain slab) is shown next to his own', async () => {
  const x = rowOf((await byUser(uD)).b);
  assert.equal(x.asUpline.value, 0.5); assert.equal(x.asUpline.chainType, 'chain');
  const r2 = rowOf((await byUser(uR)).b);
  assert.equal(r2.asUpline.slotId, null, 'a retailer with only a self slab earns nothing from a downline');
});

test('by user: the commission package a member holds is shown (not counted: packages never change the total)', async () => {
  pkgId = idOf((await db('commission_packages').insert({ owner_user_id: uD, name: `${TAG} pkg`, user_type_id: r, is_active: true }).returning('id'))[0]);
  await db('commission_package_items').insert({ package_id: pkgId, service_id: svcId, operator: '', commission_type: 'percentage', value: 1.2 });
  await db('users').where({ id: uR }).update({ commission_package_id: pkgId });
  const x = rowOf((await byUser(uR)).b);
  assert.equal(x.cells[2].package.name, `${TAG} pkg`); assert.equal(x.cells[2].package.value, 1.2); assert.equal(x.cells[2].package.net, 14.16);
  assert.equal(x.totalPaid, 26.55, 'the total is the slabs, packages only move share between levels');
  assert.equal(x.cells[1].package, undefined);
});

test('by user: a user without a type, an unknown id and a bad id are refused', async () => {
  assert.equal((await byUser(99999999)).s, 404);
  assert.equal((await byUser('abc')).s, 400);
  assert.equal((await byUser('-1')).s, 400);
  const admin = await adminUser();
  assert.equal((await byUser(admin.id)).s, 404, 'the admin is not a managed user');
});

test('selectSlab (in memory) picks the same slab as the engine\'s findSlab in every case', async () => {
  const all = await db('commission_slots').where({ service_id: svcId });
  const title = `${TAG} Recharge`;
  const cases = [
    { userTypeId: r, planId: planR, operator: null, amount: 1000 },
    { userTypeId: r, planId: planR, operator: 'Jio', amount: 1000 },
    { userTypeId: r, planId: planR, operator: 'jio', amount: 1000 },
    { userTypeId: r, planId: planR, operator: 'Airtel', amount: 1000 },
    { userTypeId: r, planId: planR, operator: null, amount: 1000, userCode: `${TAG}r` },
    { userTypeId: r, planId: planR, operator: 'Jio', amount: 1000, userCode: `${TAG}r` },
    { userTypeId: r, planId: planR, operator: null, amount: 1000, userCode: `${TAG}other` },
    { userTypeId: r, planId: planR, operator: null, amount: 1000, chainOnly: true },
    { userTypeId: d, planId: planD, operator: null, amount: 1000, chainOnly: true },
    { userTypeId: d, planId: planD, operator: null, amount: 1000, chainOnly: true, creditOnly: true },
    { userTypeId: sd, planId: planSd, operator: 'Jio', amount: 50, chainOnly: true },
    { userTypeId: r, planId: planR, operator: null, amount: 500000 },
    { userTypeId: r, planId: null, operator: null, amount: 1000 },
    { userTypeId: r, planId: planD, operator: null, amount: 1000 },
    { userTypeId: r, planId: planR, operator: null, mode: 'IMPS', amount: 1000 },
  ];
  for (const c of cases) {
    const want = await findSlab({ ...c, serviceName: title });
    const got = selectSlab(all, c);
    assert.equal(got ? got.id : null, want ? want.id : null, JSON.stringify(c));
  }
});

test('by user: a cell with his own slab also carries the type slab underneath (base), so the type one can be changed instead', async () => {
  const x = rowOf((await byUser(uR)).b);
  assert.equal(x.cells[2].scope, 'user');
  assert.equal(x.cells[2].base.value, 2); assert.equal(x.cells[2].base.commissionType, 'percentage'); assert.ok(x.cells[2].base.slotId);
  assert.equal(x.cells[1].base, undefined, 'only when his own slab is the one shown');
});
