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
let server; let A; let retailerToken; let catId; let sd; let d; let r; let planSd; let planD; let planR; let svcId; let mockId; let userId; let productId = null;
const slots = [];

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
  if (productId) await db('provider_products').where({ id: productId }).del();
  await db('commission_slots').whereIn('id', slots).del();
  await db('users').where({ id: userId }).del();
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
