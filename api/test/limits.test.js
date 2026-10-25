'use strict';

// Limit per transaction (Service Master, AEPS screens start at Rs 10,000) and booking prices that come from the provider's offer.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');

const PORT = 3896;
const BASE = `http://localhost:${PORT}`;
const TAG = `lm${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let A; let R; let typeId; let userId; let aeps; let origLimit;

const wallet = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);
const withdraw = (amount) => R.post('/api/aeps/transact', { txnType: 'withdrawal', aadhaar: '123412341234', bank: 'SBI', amount });

before(async () => {
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  typeId = idOf((await db('user_types').insert({ name: `${TAG} type` }).returning('id'))[0]);
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Limits', role: 'user', user_type_id: typeId, wallet_balance: 100000, kyc_status: 'verified',
  }).returning('id'))[0]);
  R = api(BASE, signFor(await db('users').where({ id: userId }).first()));
  for (const code of ['aeps', 'flight', 'hotel']) {
    const s = await db('services').where({ code }).first('id');
    await db('user_type_services').insert({ user_type_id: typeId, service_id: s.id });
  }
  aeps = await db('services').where({ code: 'aeps' }).first('id', 'per_txn_limit');
  origLimit = aeps.per_txn_limit;
});

after(async () => {
  await db('services').where({ id: aeps.id }).update({ per_txn_limit: origLimit });
  await db('commission_ledger').where({ user_id: userId }).del();
  await db('admin_margins').where({ user_id: userId }).del();
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('bookings').where({ retailer_id: userId }).del();
  await db('user_type_services').where({ user_type_id: typeId }).del();
  await db('users').where({ id: userId }).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('the three cash-out services start with a Rs 10,000 limit per transaction; others have none', async () => {
  const rows = await db('services').whereIn('screen', ['aeps', 'aadhar-pay', 'micro-atm']).select('screen', 'per_txn_limit');
  assert.equal(rows.length, 3);
  for (const r of rows) assert.equal(Number(r.per_txn_limit), 10000, r.screen);
  assert.equal(Number((await db('services').where({ code: 'mobile-recharge' }).first('per_txn_limit')).per_txn_limit), 0);
});

test('an AEPS withdrawal above the limit is refused (AMOUNT_LIMIT) and nothing moves; at the limit it goes through', async () => {
  await db('services').where({ id: aeps.id }).update({ per_txn_limit: 10000 });
  const before = await wallet();
  const over = await withdraw(10001);
  assert.equal(over.s, 400); assert.equal(over.b.code, 'AMOUNT_LIMIT');
  assert.equal((await withdraw(400000)).b.code, 'AMOUNT_LIMIT');
  assert.equal(await wallet(), before, 'no debit');
  assert.equal(Number((await db('service_transactions').where({ user_id: userId }).count('id as c').first()).c), 0, 'no transaction row');
  const ok = await withdraw(10000);
  assert.equal(ok.s, 201, JSON.stringify(ok.b));
  assert.equal(await wallet(), before - 10000);
});

test('the limit is set in Service Master: raise it, clear it (0 = none), and a bad value is refused', async () => {
  const set = (v) => A.put(`/api/services/${aeps.id}`, { perTxnLimit: v });
  assert.equal((await set(20000)).s, 200);
  assert.equal((await withdraw(15000)).s, 201);
  assert.equal((await set(0)).s, 200);
  assert.equal((await withdraw(25000)).s, 201, '0 = no limit');
  assert.equal((await set(-5)).s, 400);
  assert.equal((await set('abc')).s, 400);
  const row = (await A.get('/api/services?q=aeps&pageSize=50')).b.rows.find((x) => x.id === aeps.id);
  assert.equal(Number(row.per_txn_limit), 0);
  await set(10000);
});

test('booking: the provider\'s price is charged; a different client price is refused (PRICE_CHANGED); the client price is optional', async () => {
  const b0 = await wallet();
  const wrong = await R.post('/api/booking/flight/book', { offerId: 'F1', pax: { name: 'A B' }, amount: 5 });
  assert.equal(wrong.s, 409); assert.equal(wrong.b.code, 'PRICE_CHANGED'); assert.equal(wrong.b.price, 4120);
  assert.equal(await wallet(), b0, 'nothing charged');
  const ok = await R.post('/api/booking/flight/book', { offerId: 'F1', pax: { name: 'A B' }, amount: 4120 });
  assert.equal(ok.s, 201, JSON.stringify(ok.b));
  assert.equal(Number(ok.b.receipt.amount), 4120);
  assert.equal(await wallet(), b0 - 4120);
  const noAmount = await R.post('/api/booking/flight/book', { offerId: 'F2', pax: { name: 'A B' } });
  assert.equal(noAmount.s, 201, JSON.stringify(noAmount.b));
  assert.equal(Number(noAmount.b.receipt.amount), 4890);
  const rows = await db('bookings').where({ retailer_id: userId }).orderBy('id').select('amount');
  assert.deepEqual(rows.map((x) => Number(x.amount)), [4120, 4890]);
});

test('booking: an offer the search never returned is refused (INVALID_OFFER), no charge, no booking row', async () => {
  const b0 = await wallet(); const n0 = (await db('bookings').where({ retailer_id: userId })).length;
  for (const [type, offerId] of [['hotel', 'H999'], ['flight', 'ZZZ'], ['flight', 'H1']]) {
    const r = await R.post(`/api/booking/${type}/book`, { offerId, pax: { name: 'A B' }, amount: 100 });
    assert.equal(r.s, 400, `${type} ${offerId}: ${JSON.stringify(r.b)}`); assert.equal(r.b.code, 'INVALID_OFFER');
  }
  assert.equal(await wallet(), b0);
  assert.equal((await db('bookings').where({ retailer_id: userId })).length, n0);
});
