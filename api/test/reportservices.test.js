'use strict';

// "Service wise" reports for Distributor / Super Distributor / Retailer: GET /api/retailer/report-services lists the services in MY
// reports only (for the Service dropdown), and the `service` filter narrows the Service / Commission / history reports to one service.
// Rows go into a past day nobody uses (2020-03-16); the user type and users are created here and removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3922;
const BASE = `http://localhost:${PORT}`;
const TAG = `rs${Date.now()}`;
const DAY = '2020-03-16';
const AT = `${DAY} 12:00:00+00`;
const A = `${TAG} Alpha`; const B = `${TAG} Beta`; const C = `${TAG} Gamma`; const OTHER = `${TAG} Private`;
let server; let typeId; let me; let other;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const as = async (id) => api(BASE, signFor(await db('users').where({ id }).first()));

const ledger = (userId, service, net) => ({
  user_id: userId, service_name: service, slot_type: 'percent', type_value: 1, type_value_amount: net, gst_percent: 0, gst_amount: 0,
  tds_percent: 0, tds_amount: 0, net_amount: net, wallet_txn_type: 'credit', wallet_txn_amount: net, before_balance: 0, updated_balance: net, level: 0, created_at: AT,
});

before(async () => {
  server = await startServer(PORT);
  typeId = idOf((await db('user_types').insert({ name: `${TAG} R` }).returning('id'))[0]);
  const hash = await bcrypt.hash('x', 4);
  const mk = async (n) => idOf((await db('users').insert({
    username: `${TAG}${n}`, user_code: `${TAG}${n}`, password_hash: hash, mobile: '9000000000', full_name: `Rep ${n}`, role: 'user', user_type_id: typeId, wallet_balance: 0,
  }).returning('id'))[0]);
  me = await mk('m'); other = await mk('o');
  let n = 0;
  const tx = (userId, service, amount) => { n += 1; return { user_id: userId, service, status: 'success', amount, client_ref: `${TAG}-${n}`, created_at: AT }; };
  await db('service_transactions').insert([tx(me, A, 100), tx(me, A, 50), tx(me, B, 30), tx(other, OTHER, 999)]);
  await db('commission_ledger').insert([ledger(me, A, 2), ledger(me, C, 1), ledger(other, OTHER, 5)]);
  await db('account_transactions').insert([{ user_id: me, service_name: B, type: 'debit', amount: 30, before_balance: 30, updated_balance: 0, remark: 'x', created_at: AT }]);
});

after(async () => {
  const ids = [me, other];
  await db('commission_ledger').whereIn('user_id', ids).del();
  await db('service_transactions').whereIn('user_id', ids).del();
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).del();
  await db('user_types').where({ id: typeId }).del();
  await new Promise((x) => server.close(x));
  await db.destroy();
});

test('report-services lists only the services in my own reports, sorted', async () => {
  const r = await (await as(me)).get('/api/retailer/report-services');
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.deepEqual(r.b.rows, [A, B, C], 'transactions + commission + wallet history, no duplicates, nothing of the other user');
  const o = await (await as(other)).get('/api/retailer/report-services');
  assert.deepEqual(o.b.rows, [OTHER]);
});

test('the service filter narrows the Service, Commission and history reports', async () => {
  const c = await as(me);
  const sr = await c.get(`/api/retailer/service-report?startDate=${DAY}&endDate=${DAY}&service=${encodeURIComponent(A)}`);
  assert.equal(sr.s, 200, JSON.stringify(sr.b));
  assert.equal(sr.b.total, 2);
  assert.ok(sr.b.rows.every((x) => x.service === A));
  const all = await c.get(`/api/retailer/service-report?startDate=${DAY}&endDate=${DAY}`);
  assert.equal(all.b.total, 3, 'without the filter every service of mine, never the other user');

  const cr = await c.get(`/api/retailer/commission-report?startDate=${DAY}&endDate=${DAY}&service=${encodeURIComponent(C)}`);
  assert.equal(cr.b.total, 1);
  assert.equal(cr.b.rows[0].service_name, C);

  const ah = await c.get(`/api/retailer/account-history?startDate=${DAY}&endDate=${DAY}&service=${encodeURIComponent(B)}`);
  assert.equal(ah.b.total, 1);
});

test('managed users only: the admin is refused', async () => {
  const a = api(BASE, signFor(await adminUser()));
  assert.equal((await a.get('/api/retailer/report-services')).s, 403);
});
