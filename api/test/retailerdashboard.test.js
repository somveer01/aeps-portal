'use strict';

// GET /api/retailer/dashboard (Modern dashboard of Retailer / Distributor / Super Distributor): the same blocks as the admin `range`, but only
// the caller's own data, plus a `network` block for a type that has a downline. Rows go into a past day nobody uses (2020-03-15) so the
// numbers are exact on any database; the types and users are created here and removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3921;
const BASE = `http://localhost:${PORT}`;
const TAG = `rd${Date.now()}`;
const DAY = '2020-03-15';
const AT = `${DAY} 12:00:00+00`;
let server; let sdType; let rType; let sd; let r; let other;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const as = async (id) => api(BASE, signFor(await db('users').where({ id }).first()));
const get = async (id, qs = '') => (await as(id)).get(`/api/retailer/dashboard${qs}`);

const ledger = (userId, level, net) => ({
  user_id: userId, service_name: 'Mobile Recharge', slot_type: 'percent', type_value: 1, type_value_amount: net, gst_percent: 0, gst_amount: 0,
  tds_percent: 0, tds_amount: 0, net_amount: net, wallet_txn_type: 'credit', wallet_txn_amount: net, before_balance: 0, updated_balance: net, level, created_at: AT,
});

before(async () => {
  server = await startServer(PORT);
  sdType = idOf((await db('user_types').insert({ name: `${TAG} SD` }).returning('id'))[0]);
  rType = idOf((await db('user_types').insert({ name: `${TAG} R`, parent_type_id: sdType }).returning('id'))[0]);
  const hash = await bcrypt.hash('x', 4);
  const mk = async (name, typeId, parentId) => idOf((await db('users').insert({
    username: `${TAG}${name}`, user_code: `${TAG}${name}`, password_hash: hash, mobile: '9000000000', full_name: `Dash ${name}`, role: 'user',
    user_type_id: typeId, parent_id: parentId || null, wallet_balance: 0,
  }).returning('id'))[0]);
  sd = await mk('sd', sdType);
  r = await mk('r', rType, sd);
  other = await mk('o', rType); // not under sd: must never show in sd's network or r's own numbers
  let n = 0;
  const tx = (userId, service, status, amount) => { n += 1; return { user_id: userId, service, status, amount, client_ref: `${TAG}-${n}`, created_at: AT }; };
  await db('service_transactions').insert([
    tx(r, 'Mobile Recharge', 'success', 100), tx(r, 'Mobile Recharge', 'success', 50), tx(r, 'DTH Recharge', 'success', 300),
    tx(r, 'Mobile Recharge', 'pending', 70), tx(r, 'DTH Recharge', 'failed', 200), tx(r, 'Money Transfer', 'success', 1000),
    tx(sd, 'Mobile Recharge', 'success', 40),
    tx(other, 'Mobile Recharge', 'success', 9999), tx(other, 'Mobile Recharge', 'failed', 5),
  ]);
  const acct = (userId, remark, amount) => ({ user_id: userId, service_name: 'X', type: 'credit', amount, before_balance: 0, updated_balance: amount, remark, created_at: AT });
  await db('account_transactions').insert([acct(r, 'Refund — DTH Recharge failed (provider)', 200), acct(r, 'Not a refund', 999), acct(other, 'Refund — other', 77)]);
  await db('commission_ledger').insert([ledger(r, 0, 3), ledger(r, 0, 2), ledger(sd, 0, 0.5), ledger(sd, 1, 1.25), ledger(sd, 2, 0.75), ledger(other, 0, 40)]);
  const fund = (userId, id, status, amount) => ({ user_id: userId, amount, request_id: `${TAG}${id}`, status, created_at: AT, updated_at: AT, acted_at: status === 'pending' ? null : AT });
  await db('fund_requests').insert([fund(r, 'a', 'approved', 500), fund(r, 'b', 'approved', 250), fund(r, 'c', 'pending', 800), fund(r, 'd', 'rejected', 900), fund(other, 'e', 'approved', 123)]);
});

after(async () => {
  const ids = [sd, r, other];
  await db('commission_ledger').whereIn('user_id', ids).del();
  await db('service_transactions').whereIn('user_id', ids).del();
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('fund_requests').whereIn('user_id', ids).del();
  await db('users').whereIn('id', [r, other]).del();
  await db('users').where({ id: sd }).del();
  await db('user_types').where({ id: rType }).del();
  await db('user_types').where({ id: sdType }).del();
  await new Promise((x) => server.close(x));
  await db.destroy();
});

test('a retailer sees only its own numbers for the day, and no network block', async () => {
  const res = await get(r, `?from=${DAY}&to=${DAY}`);
  assert.equal(res.s, 200, JSON.stringify(res.b));
  const g = res.b;
  assert.equal(g.from, DAY);
  assert.deepEqual(g.statusBreakdown.success, { count: 4, amount: 1450 });
  assert.deepEqual(g.statusBreakdown.pending, { count: 1, amount: 70 });
  assert.deepEqual(g.statusBreakdown.failed, { count: 1, amount: 200 });
  assert.deepEqual(g.statusBreakdown.refund, { count: 1, amount: 200 }, 'own wallet credits that start with Refund');
  assert.deepEqual(g.commission, { own: 5, network: 0, total: 5 });
  assert.deepEqual(g.payIn, { count: 2, amount: 750 }, 'own approved fund requests only');
  assert.deepEqual(g.payOut, { count: 1, amount: 1000 });
  assert.equal(g.salesTotal, 1450);
  assert.deepEqual(g.topServices.map((x) => [x.service, x.count, x.amount]), [['Money Transfer', 1, 1000], ['DTH Recharge', 1, 300], ['Mobile Recharge', 2, 150]]);
  assert.deepEqual(g.salesTrend, [{ date: DAY, count: 4, amount: 1450 }]);
  assert.equal(g.network, null, 'a retailer has no downline');
});

test('a super distributor gets its own numbers plus the whole downline in `network`', async () => {
  const res = await get(sd, `?from=${DAY}&to=${DAY}`);
  assert.equal(res.s, 200, JSON.stringify(res.b));
  const g = res.b;
  assert.deepEqual(g.statusBreakdown.success, { count: 1, amount: 40 }, 'only its own services in the status block');
  assert.deepEqual(g.commission, { own: 0.5, network: 2, total: 2.5 }, 'level 0 = own business, level > 0 = from the downline');
  assert.deepEqual(g.payIn, { count: 0, amount: 0 });
  assert.ok(g.network);
  assert.deepEqual(g.network.volume, { count: 4, amount: 1450 }, 'successful services of its downline (the retailer), not of the unrelated user');
  assert.equal(g.network.commission, 2);
  assert.deepEqual(g.network.users, { total: 1, active: 1 });
});

test('ranges, all-time default and bad dates', async () => {
  const empty = await get(r, '?from=2020-03-10&to=2020-03-14');
  assert.equal(empty.b.statusBreakdown.success.count, 0);
  assert.equal(empty.b.salesTrend.length, 5);
  assert.ok(empty.b.salesTrend.every((d) => d.amount === 0));
  const all = await get(r);
  assert.equal(all.s, 200);
  assert.equal(all.b.from, null);
  assert.equal(all.b.salesTrend.length, 14);
  assert.ok(all.b.statusBreakdown.success.count >= 4);
  for (const qs of ['?from=15-03-2020', '?to=2020-02-30', '?from=2020-03-16&to=2020-03-15']) {
    // eslint-disable-next-line no-await-in-loop
    const bad = await get(r, qs);
    assert.equal(bad.s, 400, qs);
    assert.equal(bad.b.code, 'INVALID_DATE');
  }
});

test('managed users only: the admin is refused', async () => {
  const a = api(BASE, signFor(await adminUser()));
  assert.equal((await a.get('/api/retailer/dashboard')).s, 403);
});
