'use strict';

// Admin dashboard `range` block (Modern layout): status breakdown, refunds, commission in / out / net, pay in / out, sales trend and top
// services for a date range. Rows are written into a past day nobody uses (2020-03-15) so the numbers are exact on any database.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3920;
const BASE = `http://localhost:${PORT}`;
const TAG = `dr${Date.now()}`;
const DAY = '2020-03-15';
const AT = `${DAY} 12:00:00+00`;
let server; let userId; let typeId;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch
const get = async (qs = '') => (await A()).get(`/api/admin/dashboard${qs}`);

before(async () => {
  server = await startServer(PORT);
  const [t] = await db('user_types').insert({ name: `${TAG} R` }).returning('id');
  typeId = idOf(t);
  const [u] = await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('x', 4), mobile: '9000000000', full_name: 'Range Test', role: 'user',
    user_type_id: typeId, wallet_balance: 0,
  }).returning('id');
  userId = idOf(u);
  const tx = (service, status, amount) => ({ user_id: userId, service, status, amount, client_ref: `${TAG}${service}${status}${amount}`.slice(0, 40), created_at: AT });
  const rows = await db('service_transactions').insert([
    tx('Mobile Recharge', 'success', 100), tx('Mobile Recharge', 'success', 50), tx('DTH Recharge', 'success', 300),
    tx('Mobile Recharge', 'pending', 70), tx('DTH Recharge', 'failed', 200), tx('Money Transfer', 'success', 1000),
  ]).returning('id');
  await db('admin_margins').insert([
    { service_transaction_id: idOf(rows[0]), user_id: userId, service_name: 'Mobile Recharge', amount: 100, provider_commission: 4, charges_collected: 1, commission_paid: 2, margin: 3, created_at: AT },
    { service_transaction_id: idOf(rows[2]), user_id: userId, service_name: 'DTH Recharge', amount: 300, provider_commission: 10, charges_collected: 0, commission_paid: 6, margin: 4, created_at: AT },
  ]);
  await db('account_transactions').insert({ user_id: userId, service_name: 'DTH Recharge', type: 'credit', amount: 200, before_balance: 0, updated_balance: 200, remark: 'Refund — DTH Recharge failed (provider)', created_at: AT });
  await db('account_transactions').insert({ user_id: userId, service_name: 'Fund', type: 'credit', amount: 999, before_balance: 0, updated_balance: 999, remark: 'Not a refund', created_at: AT });
  await db('fund_requests').insert([
    { user_id: userId, amount: 500, request_id: `${TAG}a`, status: 'approved', created_at: AT, updated_at: AT, acted_at: AT },
    { user_id: userId, amount: 250, request_id: `${TAG}b`, status: 'approved', created_at: AT, updated_at: AT, acted_at: AT },
    { user_id: userId, amount: 800, request_id: `${TAG}c`, status: 'pending', created_at: AT, updated_at: AT },
    { user_id: userId, amount: 900, request_id: `${TAG}d`, status: 'rejected', created_at: AT, updated_at: AT, acted_at: AT },
  ]);
});

after(async () => {
  await db('admin_margins').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('account_transactions').where({ user_id: userId }).del();
  await db('fund_requests').where({ user_id: userId }).del();
  await db('users').where({ id: userId }).del();
  await db('user_types').where({ id: typeId }).del();
  await new Promise((r) => server.close(r));
  await db.destroy();
});

test('range block for one day: statuses, refund, commission, pay in / out, top services', async () => {
  const r = await get(`?from=${DAY}&to=${DAY}`);
  assert.equal(r.s, 200, JSON.stringify(r.b));
  const g = r.b.range;
  assert.equal(g.from, DAY);
  assert.deepEqual(g.statusBreakdown.success, { count: 4, amount: 1450 });
  assert.deepEqual(g.statusBreakdown.pending, { count: 1, amount: 70 });
  assert.deepEqual(g.statusBreakdown.failed, { count: 1, amount: 200 });
  assert.deepEqual(g.statusBreakdown.refund, { count: 1, amount: 200 }, 'only wallet credits whose remark starts with Refund');
  assert.deepEqual(g.commission, { in: 15, out: 8, net: 7 }, 'in = provider commission + charges (4+1+10+0)');
  assert.deepEqual(g.payIn, { count: 2, amount: 750 }, 'approved fund requests only');
  assert.deepEqual(g.payOut, { count: 1, amount: 1000 }, 'successful money transfer');
  assert.equal(g.salesTotal, 1450);
  assert.deepEqual(g.topServices.map((x) => [x.service, x.count, x.amount]), [['Money Transfer', 1, 1000], ['DTH Recharge', 1, 300], ['Mobile Recharge', 2, 150]]);
  assert.deepEqual(g.salesTrend, [{ date: DAY, count: 4, amount: 1450 }], 'one point per day of the range');
});

test('a range without those days is empty, the trend has a point per day', async () => {
  const r = await get('?from=2020-03-10&to=2020-03-14');
  const g = r.b.range;
  assert.equal(g.statusBreakdown.success.count, 0);
  assert.equal(g.payIn.amount, 0);
  assert.equal(g.salesTrend.length, 5);
  assert.ok(g.salesTrend.every((d) => d.amount === 0));
  const two = await get(`?from=2020-03-14&to=2020-03-16`);
  assert.equal(two.b.range.statusBreakdown.success.count, 4, 'a wider range still includes the day');
  assert.deepEqual(two.b.range.salesTrend.map((d) => d.date), ['2020-03-14', '2020-03-15', '2020-03-16']);
});

test('no range = all time with a 14-day trend; bad dates are refused; the classic fields are untouched', async () => {
  const r = await get();
  assert.equal(r.s, 200);
  assert.equal(r.b.range.from, null);
  assert.equal(r.b.range.salesTrend.length, 14);
  assert.ok(r.b.range.statusBreakdown.success.count >= 4, 'all time includes the rows above');
  for (const k of ['users', 'adminWallet', 'transactions', 'commission', 'fundRequests', 'services', 'recent', 'trend7', 'byService', 'actions']) assert.ok(k in r.b, `missing ${k}`);

  for (const qs of ['?from=15-03-2020', '?to=2020-02-30', '?from=2020-03-16&to=2020-03-15', '?from=abc']) {
    // eslint-disable-next-line no-await-in-loop
    const bad = await get(qs);
    assert.equal(bad.s, 400, qs);
    assert.equal(bad.b.code, 'INVALID_DATE');
  }
  const huge = await get('?from=2019-01-01&to=2020-03-15');
  assert.equal(huge.b.range.salesTrend.length, 92, 'the chart is capped at 92 days, ending at the end date');
  assert.equal(huge.b.range.salesTrend[91].date, DAY);
});

test('admin only', async () => {
  const u = await db('users').where({ id: userId }).first();
  assert.equal((await api(BASE, signFor(u)).get('/api/admin/dashboard')).s, 403);
});
