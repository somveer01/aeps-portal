'use strict';

// Money-path safety rules (written BEFORE the fixes: until each fix lands the matching test fails).
//  1. a definite provider refusal leaves a FAILED row and a refund entry in the history;
//  2. a timeout / unknown provider error is PENDING (settled later by the status check), never refunded;
//  3. a service that is not in Service Master is refused (no permission / limit / switch to check);
//  4. every money POST must carry an Idempotency-Key, and a stuck reservation does not block the key forever;
//  5. after every flow the wallet matches the ledger.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');
const { findProblems } = require('../src/services/ledgerCheck.service');

const PORT = 3892;
const BASE = `http://localhost:${PORT}`;
const TAG = `ms${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let typeId; let svc; let userId; let token;

const wallet = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);
const setWallet = (v) => db('users').where({ id: userId }).update({ wallet_balance: v });
const ok = () => Promise.resolve({ ref: `${TAG}-ref` });
const declined = () => Promise.reject(Object.assign(new Error('declined by operator'), { status: 402, code: 'PROVIDER_DECLINED', definite: true }));
const timedOut = () => Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' }));
const noProblems = async (label) => assert.deepEqual(await findProblems({ userIds: [userId] }), [], `${label}: the wallet must match its ledger`);

before(async () => {
  server = await startServer(PORT);
  typeId = idOf((await db('user_types').insert({ name: `${TAG} type` }).returning('id'))[0]);
  const cat = await db('service_categories').orderBy('id').first('id');
  svc = (await db('services').insert({ title: `${TAG} Recharge`, service_category_id: cat.id, is_active: true, provider_commission_type: 'percentage', provider_commission_value: 100 }).returning(['id', 'title']))[0];
  await db('user_type_services').insert({ user_type_id: typeId, service_id: svc.id });
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Money Safety', role: 'user', user_type_id: typeId, wallet_balance: 1000, kyc_status: 'verified',
  }).returning('id'))[0]);
  token = signFor(await db('users').where({ id: userId }).first());
});

after(async () => {
  await db('idempotency_keys').where({ user_id: userId }).del();
  await db('commission_ledger').where({ user_id: userId }).del();
  await db('admin_margins').where({ user_id: userId }).del();
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('users').where({ id: userId }).del();
  await db('user_type_services').where({ user_type_id: typeId }).del();
  await db('services').where({ id: svc.id }).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('a definite refusal keeps a failed row and a refund entry, and the wallet is whole', async () => {
  await setWallet(1000);
  await assert.rejects(pipeline.run({ user: { id: userId }, service: svc.title, amount: 100, providerCall: declined }), (e) => e.code === 'PROVIDER_DECLINED');
  assert.equal(await wallet(), 1000, 'refunded');
  const failed = await db('service_transactions').where({ user_id: userId, status: 'failed' });
  assert.equal(failed.length, 1, 'the failed attempt stays in the transaction history');
  const rows = await db('account_transactions').where({ user_id: userId }).orderBy('id');
  assert.equal(rows.length, 2, 'one debit and one refund');
  assert.equal(rows[0].type, 'debit'); assert.equal(rows[1].type, 'credit'); assert.match(rows[1].remark, /Refund/);
  await noProblems('after a refusal');
});

test('a timeout is pending: the money stays held, nothing is refunded, the status check settles it later', async () => {
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await setWallet(1000);
  const r = await pipeline.run({ user: { id: userId }, service: svc.title, amount: 100, providerCall: timedOut });
  assert.equal(r.status, 'pending');
  assert.equal(await wallet(), 900, 'still debited while the provider answer is unknown');
  const t = await db('service_transactions').where({ user_id: userId }).first();
  assert.equal(t.status, 'pending'); assert.ok(t.client_ref, 'the client reference is stored so the provider can be asked');
  assert.equal((await db('account_transactions').where({ user_id: userId, type: 'credit' })).length, 0, 'no refund');
  // The pending row settles through the existing finalize(): a later "failed" answer refunds exactly once.
  assert.equal((await pipeline.finalize(t.id, 'failed', { source: 'status_check' })).status, 'failed');
  assert.equal(await wallet(), 1000);
  assert.equal((await pipeline.finalize(t.id, 'failed', { source: 'status_check' })).changed, false, 'not refunded twice');
  await noProblems('after a timeout and its settlement');
});

test('a service that is not in Service Master is refused and nothing is debited', async () => {
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await setWallet(1000);
  await assert.rejects(pipeline.run({ user: { id: userId }, service: `${TAG} Not In Master`, amount: 100, providerCall: ok }), (e) => e.code === 'SERVICE_NOT_CONFIGURED');
  assert.equal(await wallet(), 1000);
  assert.equal((await db('service_transactions').where({ user_id: userId })).length, 0);
});

test('a money POST without an Idempotency-Key is refused', async () => {
  const r = await api(BASE, token).post('/api/recharge/mobile', {}, { 'Idempotency-Key': '' });
  assert.equal(r.s, 400);
  assert.equal(r.b.code, 'IDEMPOTENCY_KEY_REQUIRED');
  // Every money endpoint is covered, not just this one.
  const adminTok = signFor(await require('./helper').adminUser());
  for (const [method, p] of [['post', '/api/admin-wallet/add'], ['post', '/api/fund-transfers'], ['post', '/api/users/1/fund'], ['put', '/api/fund-requests/1']]) {
    const x = await api(BASE, adminTok)[method](p, {}, { 'Idempotency-Key': '' });
    assert.equal(x.b.code, 'IDEMPOTENCY_KEY_REQUIRED', p);
  }
  for (const p of ['/api/recharge/dth', '/api/bbps/pay', '/api/aeps/transact', '/api/dmt/transfer', '/api/move-to-bank', '/api/my/fund-requests']) {
    assert.equal((await api(BASE, token).post(p, {}, { 'Idempotency-Key': '' })).b.code, 'IDEMPOTENCY_KEY_REQUIRED', p);
  }
});

test('a key reused for a different request is refused, and a repeated key replays the first answer', async () => {
  const key = `${TAG}-reuse`;
  const first = await api(BASE, token).post('/api/recharge/mobile', {}, { 'Idempotency-Key': key });
  assert.equal(first.s, 400); // empty body: a normal validation error (not stored: failures free the key)
  const other = await api(BASE, token).post('/api/recharge/dth', {}, { 'Idempotency-Key': key });
  assert.equal(other.s, 400);
  // a successful call stores its answer: the same key replays it
  await db('idempotency_keys').insert({ user_id: userId, idem_key: `${key}-done`, endpoint: 'POST /api/recharge/mobile', response_status: 201, response_body: JSON.stringify({ receipt: { replayed: true } }) });
  const replay = await api(BASE, token).post('/api/recharge/mobile', { amount: 5 }, { 'Idempotency-Key': `${key}-done` });
  assert.equal(replay.s, 201); assert.equal(replay.b.receipt.replayed, true); assert.equal(replay.h.get('idempotent-replay'), 'true');
  const wrong = await api(BASE, token).post('/api/recharge/dth', {}, { 'Idempotency-Key': `${key}-done` });
  assert.equal(wrong.s, 409); assert.equal(wrong.b.code, 'IDEMPOTENCY_KEY_REUSED');
  // a fresh, still-running reservation is "in progress", not released
  await db('idempotency_keys').insert({ user_id: userId, idem_key: `${key}-busy`, endpoint: 'POST /api/recharge/mobile', response_status: 0 });
  assert.equal((await api(BASE, token).post('/api/recharge/mobile', {}, { 'Idempotency-Key': `${key}-busy` })).b.code, 'IDEMPOTENT_IN_PROGRESS');
});

test('a reservation stuck "in progress" for minutes does not block the key forever', async () => {
  const key = `${TAG}-stuck`;
  await db('idempotency_keys').insert({ user_id: userId, idem_key: key, endpoint: 'POST /api/recharge/mobile', response_status: 0, created_at: db.raw("now() - interval '10 minutes'") });
  const r = await api(BASE, token).post('/api/recharge/mobile', {}, { 'Idempotency-Key': key });
  assert.notEqual(r.s, 409, 'the stale reservation is released and the request runs (here: a normal 400 for the empty body)');
  assert.notEqual(r.b.code, 'IDEMPOTENT_IN_PROGRESS');
});
