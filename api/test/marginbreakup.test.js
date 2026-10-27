'use strict';

// Admin Margin report: who was paid. `commission_paid` is the sum of the commission credits of the transaction's ledger entries, so every
// row carries its payees (breakup) and the amount per user type (by_type), and the result carries the types paid with their totals.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');

const PORT = 3899;
const BASE = `http://localhost:${PORT}`;
const TAG = `mb${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let A; let sd; let d; let r; let uSd; let uD; let uR; let svcName; let txnId; let txn2;

const mkUser = async (key, typeId, parentId) => idOf((await db('users').insert({
  username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000', full_name: `Pay ${key}`,
  role: 'user', user_type_id: typeId, parent_id: parentId, kyc_status: 'verified',
}).returning('id'))[0]);
const ledger = (userId, level, net, extra = {}) => db('commission_ledger').insert({
  user_id: userId, service_name: svcName, level, net_amount: net, wallet_txn_type: 'credit', wallet_txn_amount: net, service_transaction_id: txnId, ...extra,
});
const report = (q = '') => A.get(`/api/admin-margin-report?service=${encodeURIComponent(svcName)}&pageSize=50&${q}`);

before(async () => {
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  svcName = `${TAG} Recharge`;
  sd = idOf((await db('user_types').insert({ name: `${TAG} SD` }).returning('id'))[0]);
  d = idOf((await db('user_types').insert({ name: `${TAG} D`, parent_type_id: sd }).returning('id'))[0]);
  r = idOf((await db('user_types').insert({ name: `${TAG} R`, parent_type_id: d }).returning('id'))[0]);
  uSd = await mkUser('sd', sd, null); uD = await mkUser('d', d, uSd); uR = await mkUser('r', r, uD);
  // A 1000 recharge by the retailer: R 23.60, D 5.90, SD 2.95 (commission + GST) = 32.45 paid; the API paid 40.
  txnId = idOf((await db('service_transactions').insert({ user_id: uR, service: svcName, amount: 1000, status: 'success' }).returning('id'))[0]);
  await db('admin_margins').insert({ service_transaction_id: txnId, user_id: uR, service_name: svcName, amount: 1000, provider_commission: 40, charges_collected: 0, commission_paid: 32.45, margin: 7.55 });
  await ledger(uR, 0, 23.6); await ledger(uD, 1, 5.9); await ledger(uSd, 2, 2.95);
  await ledger(uR, 0, 5, { wallet_txn_type: 'debit', wallet_txn_amount: 5 }); // a service charge debit is not commission paid
  // An older row whose ledger entries are not linked to it.
  txn2 = idOf((await db('service_transactions').insert({ user_id: uR, service: svcName, amount: 500, status: 'success' }).returning('id'))[0]);
  await db('admin_margins').insert({ service_transaction_id: txn2, user_id: uR, service_name: svcName, amount: 500, provider_commission: 10, charges_collected: 0, commission_paid: 4, margin: 6 });
});

after(async () => {
  await db('commission_ledger').whereIn('user_id', [uR, uD, uSd]).del();
  await db('admin_margins').whereIn('service_transaction_id', [txnId, txn2]).del();
  await db('service_transactions').whereIn('id', [txnId, txn2]).del();
  await db('users').whereIn('id', [uR, uD, uSd]).del();
  await db('user_types').whereIn('id', [r, d, sd]).del();
  server.close();
  await db.destroy();
});

test('each margin row carries its payees, top level first, and the amount per user type; the payees add up to "paid out"', async () => {
  const x = (await report()).b.rows.find((row) => row.service_transaction_id === txnId);
  assert.deepEqual(x.breakup.map((p) => p.typeId), [sd, d, r], 'top of the chain first');
  assert.deepEqual(x.breakup.map((p) => p.amount), [2.95, 5.9, 23.6]);
  assert.deepEqual(x.breakup.map((p) => p.level), [2, 1, 0]);
  assert.equal(x.breakup[0].userCode, `${TAG}sd`);
  assert.equal(x.by_type[sd], 2.95); assert.equal(x.by_type[d], 5.9); assert.equal(x.by_type[r], 23.6);
  assert.equal(x.unlinked, 0, 'the breakup explains all of paid out');
  assert.equal(Number(x.commission_paid), 32.45);
});

test('the result lists the types that were paid, top level first, with their totals; the debit (service charge) is not counted', async () => {
  const b = (await report()).b;
  assert.deepEqual(b.breakup.types.map((t) => t.id), [sd, d, r]);
  assert.deepEqual(b.breakup.types.map((t) => t.total), [2.95, 5.9, 23.6]);
  assert.deepEqual(b.breakup.types.map((t) => t.depth), [1, 2, 3]);
  assert.equal(b.totals.commission_paid, 36.45);
  assert.equal(b.breakup.unlinked, 4, 'the older row (4.00) has no linked ledger entries');
  assert.equal(b.totals.commission_paid, b.breakup.types.reduce((s, t) => s + t.total, 0) + b.breakup.unlinked);
});

test('a row whose ledger entries are not linked shows the difference as unlinked, with an empty breakup', async () => {
  const x = (await report()).b.rows.find((row) => row.service_transaction_id === txn2);
  assert.deepEqual(x.breakup, []); assert.deepEqual(x.by_type, {}); assert.equal(x.unlinked, 4);
});

test('the per-type totals follow the filters (here: the date filter)', async () => {
  const b = (await report('startDate=2999-01-01')).b;
  assert.deepEqual(b.breakup.types, []); assert.equal(b.breakup.unlinked, 0);
});
