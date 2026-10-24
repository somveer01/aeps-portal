'use strict';

// Concurrency / money-integrity hammer. Fires PARALLEL requests (direct service calls AND the HTTP endpoints) at every
// money path and proves: no double spend, no negative wallet, no lost update, no wallet/ledger drift, no deadlock.
//
// Runs ONLY on an isolated QA database (name must start with "fintech_qa_"; override with QA_ALLOW_ANY_DB=1):
//   PGDATABASE=fintech_qa_c node --test --test-concurrency=1 test/concurrency.test.js
// Everything it creates (users, types, services, slabs ...) is removed in after(). Mock providers only.
// A test whose name carries [BUG] fails because of a genuine defect in the production code (see the test body).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor } = require('./helper');
const env = require('../src/config/env');
const pipeline = require('../src/services/txnPipeline.service');
const wallet = require('../src/services/wallet.service');
const fundRepo = require('../src/repositories/fundTransfer.repo');
const fundRequest = require('../src/services/fundRequest.service');
const { findProblems } = require('../src/services/ledgerCheck.service');

const PORT = 3860;
const BASE = `http://localhost:${PORT}`;
const TAG = `cc${Date.now().toString(36)}`;
const PW = 'Test@1234';
const idOf = (r) => (typeof r === 'object' ? r.id : r);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

let server; let pwHash;
const T = {}; // user types: SD, D, R
let svcPlain; let svcChain; let svcLimit; let svcM; let svcMOrig; let planId; let bankId = null;
const created = { users: [], slabs: [] };

// ── helpers ──────────────────────────────────────────────────────────────────
/** Fail the test (instead of hanging forever) when a batch of parallel calls does not finish: that is a deadlock / pool stall. */
function within(ms, label, p) {
  let timer;
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms} ms: ${label} (deadlock or connection-pool stall?)`)), ms); });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}
const bal = async (id) => Number((await db('users').where({ id }).first('wallet_balance')).wallet_balance);
const fund = (userId, amount, remark = 'QA seed') => db.transaction((trx) => wallet.credit(trx, { userId, amount, service: 'QA Seed', remark }));
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

let userSeq = 0;
async function mkUser(key, { type = null, parent = null, wallet: w = 0, role = 'user', plan = null } = {}) {
  userSeq += 1;
  const id = idOf((await db('users').insert({
    username: `${TAG}${key}${userSeq}`, user_code: `${TAG}${key}${userSeq}`, password_hash: pwHash, mobile: '9000000000',
    full_name: `QA ${key}`, role, user_type_id: type, plan_id: plan, parent_id: parent, wallet_balance: 0, kyc_status: 'verified',
  }).returning('id'))[0]);
  created.users.push(id);
  if (w > 0) await fund(id, w);
  return id;
}
const mkAdmin = (key, w = 0) => mkUser(`${key}adm`, { role: 'admin', wallet: w });
/** admin -> SD -> D -> R1, R2 (parent_id chain, like production: the SD sits under the admin). */
async function mkChain(key, { admin = null, wallets = {} } = {}) {
  const adm = admin || await mkAdmin(key, wallets.admin ?? 100000);
  const sd = await mkUser(`${key}sd`, { type: T.SD, parent: adm, plan: planId, wallet: wallets.sd ?? 0 });
  const d = await mkUser(`${key}d`, { type: T.D, parent: sd, plan: planId, wallet: wallets.d ?? 0 });
  const r1 = await mkUser(`${key}r1`, { type: T.R, parent: d, plan: planId, wallet: wallets.r ?? 10000 });
  const r2_ = await mkUser(`${key}r2`, { type: T.R, parent: d, plan: planId, wallet: wallets.r ?? 10000 });
  return { adm, sd, d, r1, r2: r2_ };
}
const tokenOf = async (id) => signFor(await db('users').where({ id }).first());
const apiOf = async (id) => api(BASE, await tokenOf(id));

const ok = () => Promise.resolve({ ref: `${TAG}-ref` });
const pendingProvider = () => Promise.resolve({ ref: `${TAG}-p`, status: 'pending' });
const declined = () => Promise.reject(Object.assign(new Error('declined by operator'), { status: 402, code: 'PROVIDER_DECLINED', definite: true }));
const timedOut = () => Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' }));
const runFor = (userId, service, amount, providerCall = ok) => pipeline.run({ user: { id: userId }, service: service.title, amount, providerCall });
const mobileBody = (amount) => ({ number: '9876543210', operator: 'Airtel', amount });
const noProblems = async (ids, label) => assert.deepEqual(await findProblems({ userIds: ids }), [], `${label}: wallets must match their ledgers`);
const rejectedCodes = (settled) => settled.filter((s) => s.status === 'rejected').map((s) => (s.reason && (s.reason.code || s.reason.message)) || String(s.reason));
const count = (arr) => arr.reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {});

/** admin_wallet_transactions of an admin must chain (each row starts where the one before ended, ends at the wallet). */
async function assertAdminWalletChain(adminId, label) {
  const rows = await db('admin_wallet_transactions').where({ admin_id: adminId }).orderBy('id');
  let prev = null;
  rows.forEach((x) => {
    const expect = x.txn_type === 'credit' ? r2(Number(x.before_balance) + Number(x.amount)) : r2(Number(x.before_balance) - Number(x.amount));
    assert.equal(Number(x.updated_balance), expect, `${label}: admin_wallet_transactions row ${x.id} math`);
    if (prev !== null) assert.equal(Number(x.before_balance), prev, `${label}: admin_wallet_transactions row ${x.id} does not start where the row before ended`);
    prev = Number(x.updated_balance);
  });
  if (rows.length) assert.equal(prev, await bal(adminId), `${label}: admin wallet differs from the last admin_wallet_transactions row`);
}

// ── fixtures ────────────────────────────────────────────────────────────────
before(async () => {
  const { rows } = await db.raw('select current_database() as d');
  const dbName = rows[0].d;
  if (!/^fintech_qa_/.test(dbName) && process.env.QA_ALLOW_ANY_DB !== '1') {
    throw new Error(`concurrency.test.js refuses to run on database "${dbName}" (use an isolated fintech_qa_* database)`);
  }
  pwHash = await bcrypt.hash(PW, 4);
  server = await startServer(PORT);
  for (const [k, name] of [['SD', 'sd'], ['D', 'd'], ['R', 'r']]) T[k] = idOf((await db('user_types').insert({ name: `${TAG} ${name}` }).returning('id'))[0]);
  // the user-type tree SD -> D -> R (network panel gate: who may have a downline)
  await db('user_types').where({ id: T.D }).update({ parent_type_id: T.SD });
  await db('user_types').where({ id: T.R }).update({ parent_type_id: T.D });
  const cat = await db('service_categories').orderBy('id').first('id');
  const mkSvc = async (title, extra = {}) => (await db('services').insert({
    title: `${TAG} ${title}`, service_category_id: cat.id, is_active: true, provider_commission_type: 'percentage', provider_commission_value: 100, ...extra,
  }).returning(['id', 'title']))[0];
  svcPlain = await mkSvc('Plain');
  svcChain = await mkSvc('Chain');
  svcLimit = await mkSvc('Limited', { daily_limit: 1000 });
  svcM = await db('services').whereRaw("lower(title) = 'mobile recharge'").orderBy('id').first('id', 'title', 'daily_limit', 'is_active');
  assert.ok(svcM, 'seeded Mobile Recharge service');
  svcMOrig = { daily_limit: svcM.daily_limit, is_active: svcM.is_active };
  await db('services').where({ id: svcM.id }).update({ is_active: true, daily_limit: 0 });
  for (const t of Object.values(T)) {
    for (const s of [svcPlain, svcChain, svcLimit, svcM]) await db('user_type_services').insert({ user_type_id: t, service_id: s.id }).onConflict(['user_type_id', 'service_id']).ignore();
  }
  planId = idOf((await db('plans').insert({ user_type_id: T.R, name: `${TAG} plan` }).returning('id'))[0]);
  const slab = async (type, ctype, value, chain) => created.slabs.push(idOf((await db('commission_slots').insert({
    user_type_id: type, service_id: svcChain.id, plan_id: planId, commission_type: ctype, value, min_amount: 1, max_amount: 10000, chain_type: chain, txn_type: 'credit', is_active: true,
  }).returning('id'))[0]));
  await slab(T.R, 'percentage', 2, 'self'); // 2% of 500 = 10 + 1.8 GST = 11.80
  await slab(T.D, 'amount', 5, 'chain'); //     5 + 0.9 GST = 5.90
  await slab(T.SD, 'percentage', 1, 'chain'); // 1% of 500 = 5 + 0.9 GST = 5.90
});

after(async () => {
  try {
    await db('services').where({ id: svcM.id }).update(svcMOrig);
    const ids = created.users;
    await db('fund_transfers').where((q) => q.whereIn('from_user_id', ids).orWhereIn('to_user_id', ids)).del();
    await db('fund_requests').whereIn('user_id', ids).del();
    await db('idempotency_keys').whereIn('user_id', ids).del();
    await db('commission_ledger').whereIn('user_id', ids).del();
    await db('admin_margins').whereIn('user_id', ids).del();
    await db('service_transactions').whereIn('user_id', ids).del();
    await db('account_transactions').whereIn('user_id', ids).del();
    await db('admin_wallet_transactions').whereIn('admin_id', ids).del();
    await db('audit_log').whereIn('user_id', ids).del().catch(() => {});
    await db('users').whereIn('id', ids).del();
    if (bankId) await db('company_banks').where({ id: bankId }).del();
    await db('commission_slots').whereIn('id', created.slabs).del();
    await db('plans').where({ id: planId }).del();
    await db('user_type_services').whereIn('user_type_id', Object.values(T)).del();
    await db('services').whereIn('id', [svcPlain.id, svcChain.id, svcLimit.id]).del();
    await db('user_types').whereIn('id', Object.values(T)).del();
  } finally {
    server.close();
    await db.destroy();
  }
});

// ── 1. same retailer, many parallel debits ───────────────────────────────────
test('1a. wallet 1000, 30 parallel pipeline.run of 100 -> exactly 10 succeed, 20 INSUFFICIENT_BALANCE, wallet 0, ledger consistent', async () => {
  const u = await mkUser('s1a', { type: T.R, wallet: 1000 });
  const res = await within(40000, '1a', Promise.allSettled(Array.from({ length: 30 }, () => runFor(u, svcPlain, 100))));
  assert.equal(res.filter((x) => x.status === 'fulfilled' && x.value.status === 'success').length, 10, JSON.stringify(count(rejectedCodes(res))));
  const codes = count(rejectedCodes(res));
  assert.deepEqual(codes, { INSUFFICIENT_BALANCE: 20 }, `unexpected rejections: ${JSON.stringify(codes)}`);
  assert.equal(await bal(u), 0);
  assert.equal(Number((await db('service_transactions').where({ user_id: u, status: 'success' }).count('id as c').first()).c), 10);
  assert.equal(Number((await db('service_transactions').where({ user_id: u }).count('id as c').first()).c), 10, 'a refused attempt leaves no row');
  await noProblems([u], '1a');
});

test('1b. same over HTTP (POST /api/recharge/mobile, distinct keys): 10 x 201, 20 x 400 INSUFFICIENT_BALANCE, wallet 0', async () => {
  const u = await mkUser('s1b', { type: T.R, wallet: 1000 });
  const a = await apiOf(u);
  const res = await within(40000, '1b', Promise.all(Array.from({ length: 30 }, () => a.post('/api/recharge/mobile', mobileBody(100)))));
  const by = count(res.map((x) => `${x.s}${x.b.code ? `:${x.b.code}` : ''}`));
  assert.deepEqual(by, { 201: 10, '400:INSUFFICIENT_BALANCE': 20 }, JSON.stringify(by));
  assert.equal(await bal(u), 0);
  assert.equal(Number((await db('service_transactions').where({ user_id: u, status: 'success' }).count('id as c').first()).c), 10);
  await noProblems([u], '1b');
});

// ── 2. the same Idempotency-Key, 20 times in parallel ────────────────────────
async function hammerSameKey(call, n = 20) {
  const res = await within(40000, 'same-key', Promise.all(Array.from({ length: n }, () => call())));
  const executed = res.filter((x) => (x.s === 200 || x.s === 201) && x.h.get('idempotent-replay') !== 'true');
  const replays = res.filter((x) => x.h.get('idempotent-replay') === 'true');
  const busy = res.filter((x) => x.s === 409 && x.b.code === 'IDEMPOTENT_IN_PROGRESS');
  const other = res.filter((x) => !executed.includes(x) && !replays.includes(x) && !busy.includes(x));
  return { res, executed, replays, busy, other };
}
function assertOneExecution(h, label) {
  assert.equal(h.executed.length, 1, `${label}: executions=${h.executed.length} replays=${h.replays.length} busy=${h.busy.length} other=${JSON.stringify(h.other.map((x) => [x.s, x.b.code]))}`);
  assert.equal(h.other.length, 0, `${label}: unexpected answers ${JSON.stringify(h.other.map((x) => [x.s, x.b]))}`);
  h.replays.forEach((x) => assert.deepEqual(x.b, h.executed[0].b, `${label}: a replay must return the original answer`));
}

test('2a. same Idempotency-Key x20 on POST /api/recharge/mobile -> one debit, others replay / IDEMPOTENT_IN_PROGRESS', async () => {
  const u = await mkUser('s2a', { type: T.R, wallet: 1000 });
  const a = await apiOf(u);
  const key = `${TAG}-2a`;
  const h = await hammerSameKey(() => a.post('/api/recharge/mobile', mobileBody(100), { 'Idempotency-Key': key }));
  assertOneExecution(h, '2a');
  assert.equal(await bal(u), 900, 'debited exactly once');
  assert.equal(Number((await db('service_transactions').where({ user_id: u }).count('id as c').first()).c), 1);
  // once the winner finished, the key replays its answer
  await sleep(300);
  const again = await a.post('/api/recharge/mobile', mobileBody(100), { 'Idempotency-Key': key });
  assert.equal(again.h.get('idempotent-replay'), 'true'); assert.deepEqual(again.b, h.executed[0].b);
  assert.equal(await bal(u), 900);
  await noProblems([u], '2a');
});

test('2b. same Idempotency-Key x20 on POST /api/admin-wallet/add -> credited once', async () => {
  const adm = await mkAdmin('s2b', 0);
  const a = await apiOf(adm);
  const h = await hammerSameKey(() => a.post('/api/admin-wallet/add', { amount: 50, txnType: 'credit', remark: 'qa same key' }, { 'Idempotency-Key': `${TAG}-2b` }));
  assertOneExecution(h, '2b');
  assert.equal(await bal(adm), 50);
  assert.equal(Number((await db('admin_wallet_transactions').where({ admin_id: adm }).count('id as c').first()).c), 1);
  await noProblems([adm], '2b'); await assertAdminWalletChain(adm, '2b');
});

test('2c. same Idempotency-Key x20 on POST /api/fund-transfers -> one transfer, wallets moved once', async () => {
  const adm = await mkAdmin('s2c', 1000);
  const u = await mkUser('s2c', { type: T.R, parent: adm, wallet: 0 });
  const a = await apiOf(adm);
  const body = { userId: u, amount: 70, txnType: 'credit', transactionPassword: PW, remark: 'qa same key' };
  const h = await hammerSameKey(() => a.post('/api/fund-transfers', body, { 'Idempotency-Key': `${TAG}-2c` }));
  assertOneExecution(h, '2c');
  assert.equal(await bal(u), 70); assert.equal(await bal(adm), 930);
  assert.equal(Number((await db('fund_transfers').where({ to_user_id: u }).count('id as c').first()).c), 1);
  await noProblems([u, adm], '2c'); await assertAdminWalletChain(adm, '2c');
});

test('2d. a request that FAILS frees its key: 20 parallel same-key calls that all fail never debit', async () => {
  const u = await mkUser('s2d', { type: T.R, wallet: 5 }); // too little: every attempt is INSUFFICIENT_BALANCE
  const a = await apiOf(u);
  const res = await within(40000, '2d', Promise.all(Array.from({ length: 20 }, () => a.post('/api/recharge/mobile', mobileBody(100), { 'Idempotency-Key': `${TAG}-2d` }))));
  res.forEach((x) => assert.ok((x.s === 400 && x.b.code === 'INSUFFICIENT_BALANCE') || (x.s === 409 && x.b.code === 'IDEMPOTENT_IN_PROGRESS'), JSON.stringify([x.s, x.b])));
  assert.equal(await bal(u), 5);
  await noProblems([u], '2d');
});

// ── 3. parallel fund transfers between the same two wallets ──────────────────
test('3a. 40 parallel repo.transfer admin<->user (credit and debit): no deadlock, no negative wallet, sum conserved, ledgers consistent', async () => {
  const adm = await mkAdmin('s3a', 1000);
  const u = await mkUser('s3a', { type: T.R, parent: adm, wallet: 1000 });
  const rand = rng(31);
  const res = await within(40000, '3a', Promise.allSettled(Array.from({ length: 40 }, (_, i) => fundRepo.transfer({
    fromUserId: adm, toUserId: u, amount: 1 + Math.floor(rand() * 400), transferType: i % 2 ? 'debit' : 'credit', remark: 'qa', senderLabel: 'admin',
  }))));
  const rejected = res.filter((x) => x.status === 'rejected');
  assert.equal(rejected.length, 0, `transfers threw: ${rejected.map((x) => x.reason.code || x.reason.message).join(', ')}`);
  const okN = res.filter((x) => x.value.ok).length;
  assert.equal((await bal(adm)) + (await bal(u)), 2000, 'money created or destroyed');
  assert.ok((await bal(adm)) >= 0 && (await bal(u)) >= 0);
  assert.equal(Number((await db('fund_transfers').where({ to_user_id: u }).count('id as c').first()).c), okN);
  assert.equal(Number((await db('account_transactions').where({ user_id: u, service_name: 'Fund Transfer' }).count('id as c').first()).c), okN);
  await noProblems([u, adm], '3a'); await assertAdminWalletChain(adm, '3a');
});

test('3b. 40 parallel POST /api/fund-transfers admin<->user over HTTP: same guarantees', async () => {
  const adm = await mkAdmin('s3b', 1000);
  const u = await mkUser('s3b', { type: T.R, parent: adm, wallet: 1000 });
  const a = await apiOf(adm);
  const rand = rng(32);
  const res = await within(50000, '3b', Promise.all(Array.from({ length: 40 }, (_, i) => a.post('/api/fund-transfers', {
    userId: u, amount: 1 + Math.floor(rand() * 400), txnType: i % 2 ? 'debit' : 'credit', transactionPassword: PW, remark: 'qa',
  }))));
  res.forEach((x) => assert.ok(x.s === 201 || (x.s === 400 && x.b.code === 'TRANSFER_FAILED'), `unexpected ${x.s} ${JSON.stringify(x.b)}`));
  assert.equal((await bal(adm)) + (await bal(u)), 2000);
  assert.equal(Number((await db('fund_transfers').where({ to_user_id: u }).count('id as c').first()).c), res.filter((x) => x.s === 201).length);
  await noProblems([u, adm], '3b'); await assertAdminWalletChain(adm, '3b');
});

test('3c. transfers + retailer-chain transactions + admin wallet adjustments at once on the admin wallet (lock order child -> parent): no deadlock', async () => {
  const c = await mkChain('s3c', { wallets: { admin: 20000, r: 5000 } });
  const rand = rng(33);
  const a = await apiOf(c.adm);
  const ops = [];
  for (let i = 0; i < 60; i += 1) {
    const who = [c.r1, c.r2, c.d, c.sd][i % 4];
    if (i % 3 === 0) ops.push(() => runFor(who === c.d || who === c.sd ? c.r1 : who, svcChain, 100 + Math.floor(rand() * 400)));
    else if (i % 3 === 1) ops.push(() => fundRepo.transfer({ fromUserId: c.adm, toUserId: who, amount: 1 + Math.floor(rand() * 200), transferType: rand() > 0.5 ? 'debit' : 'credit' }));
    else ops.push(() => a.post('/api/admin-wallet/add', { amount: 1 + Math.floor(rand() * 50), txnType: rand() > 0.5 ? 'debit' : 'credit', remark: 'qa' }));
  }
  const res = await within(50000, '3c', Promise.allSettled(ops.map((f) => f())));
  const hard = res.filter((x) => x.status === 'rejected' && !['INSUFFICIENT_BALANCE'].includes(x.reason.code));
  assert.equal(hard.length, 0, `hard failures: ${hard.map((x) => `${x.reason.code}:${x.reason.message}`).join(' | ')}`);
  await noProblems(Object.values(c), '3c'); await assertAdminWalletChain(c.adm, '3c');
});

// ── 4. provider call in flight while the same wallet changes ─────────────────
test('4. slow provider call (4 s) in flight: credits, other recharges and fund transfers on the same wallet are not blocked and nothing is lost', async () => {
  const adm = await mkAdmin('s4', 5000);
  const u = await mkUser('s4', { type: T.R, parent: adm, wallet: 1000 });
  const slow = async () => { await sleep(4000); return { ref: `${TAG}-slow` }; };
  const t0 = Date.now();
  let slowFinished = false;
  const slowRuns = Array.from({ length: 3 }, () => runFor(u, svcPlain, 100, slow));
  Promise.allSettled(slowRuns).then(() => { slowFinished = true; });
  // wait until all three are really in phase B (recorded as 'initiated', money held)
  for (let i = 0; i < 100; i += 1) {
    if (Number((await db('service_transactions').where({ user_id: u, stage: 'initiated' }).count('id as c').first()).c) === 3) break;
    await sleep(20);
  }
  assert.equal(await bal(u), 700, 'the three attempts hold their money');
  const t1 = Date.now();
  const others = [
    ...Array.from({ length: 5 }, () => runFor(u, svcPlain, 50)),
    ...Array.from({ length: 4 }, () => db.transaction((trx) => wallet.credit(trx, { userId: u, amount: 10, service: 'QA', remark: 'during provider call' }))),
    fundRepo.transfer({ fromUserId: adm, toUserId: u, amount: 30, transferType: 'credit' }),
    fundRepo.transfer({ fromUserId: adm, toUserId: u, amount: 10, transferType: 'debit' }),
  ];
  const res = await within(20000, '4 others', Promise.allSettled(others));
  const elapsed = Date.now() - t1;
  assert.equal(res.filter((x) => x.status === 'rejected').length, 0, JSON.stringify(rejectedCodes(res)));
  assert.equal(slowFinished, false, `other requests only finished after the slow provider calls (took ${elapsed} ms): the wallet was locked during phase B`);
  const slowRes = await within(20000, '4 slow', Promise.allSettled(slowRuns));
  assert.equal(slowRes.filter((x) => x.status === 'fulfilled' && x.value.status === 'success').length, 3, JSON.stringify(rejectedCodes(slowRes)));
  assert.ok(Date.now() - t0 >= 4000);
  assert.equal(await bal(u), 1000 - 300 - 250 + 40 + 30 - 10, 'start - debits + credits, exactly (a lost update shows here)');
  await noProblems([u, adm], '4');
});

// ── 5. a pending transaction settled concurrently ────────────────────────────
async function pendingTxn(userId) {
  const r = await runFor(userId, svcChain, 500, pendingProvider);
  assert.equal(r.status, 'pending');
  return (await db('service_transactions').where({ client_ref: r.clientRef }).first()).id;
}
const SOURCES = ['callback', 'status_check', 'reconciliation', 'admin'];
async function settleRace(label, modeOf) {
  const c = await mkChain(`s5${label}`, { wallets: { admin: 1000, r: 5000, d: 100, sd: 100 } });
  const outcomes = [];
  for (let round = 0; round < 6; round += 1) {
    const mode = modeOf(round);
    const before = { r: await bal(c.r1), d: await bal(c.d), sd: await bal(c.sd) };
    const id = await pendingTxn(c.r1);
    const heldR = await bal(c.r1);
    assert.equal(heldR, before.r - 500, 'money held');
    const res = await within(30000, `5 ${label} r${round}`, Promise.allSettled(Array.from({ length: 20 }, (_, i) => pipeline.finalize(id, mode === 'mixed' ? (i % 2 ? 'success' : 'failed') : mode, { source: SOURCES[i % 4] }))));
    assert.equal(res.filter((x) => x.status === 'rejected').length, 0, JSON.stringify(rejectedCodes(res)));
    const changed = res.filter((x) => x.value.changed);
    assert.equal(changed.length, 1, `round ${round}: ${changed.length} settlements`);
    const final = changed[0].value.status;
    res.forEach((x) => assert.equal(x.value.status, final, 'every caller sees the one settled status'));
    const row = await db('service_transactions').where({ id }).first();
    assert.equal(row.status, final); assert.equal(row.stage, null);
    const comm = await db('commission_ledger').where({ service_transaction_id: id });
    const margins = await db('admin_margins').where({ service_transaction_id: id });
    const refunds = await db('account_transactions').where({ user_id: c.r1, type: 'credit' }).whereRaw("remark like 'Refund%'");
    if (final === 'failed') {
      assert.equal(await bal(c.r1), before.r, 'refunded once');
      assert.equal(comm.length, 0, 'no commission on a failed transaction'); assert.equal(margins.length, 0);
      assert.equal(refunds.length, outcomes.filter((o) => o === 'failed').length + 1, 'one refund per failed transaction, never two');
    } else {
      assert.equal(await bal(c.r1), r2(before.r - 500 + 11.8), 'own commission once, no refund');
      assert.equal(await bal(c.d), r2(before.d + 5.9), 'distributor paid once');
      assert.equal(await bal(c.sd), r2(before.sd + 5.9), 'super distributor paid once');
      assert.deepEqual(comm.map((x) => x.level).sort(), [0, 1, 2], 'one commission row per level');
      assert.equal(margins.length, 1, 'one admin margin row');
      assert.ok(Number(margins[0].margin) >= 0);
      assert.equal(refunds.length, outcomes.filter((o) => o === 'failed').length, 'a success is never refunded');
    }
    outcomes.push(final);
  }
  await noProblems(Object.values(c), `5 ${label}`);
  return outcomes;
}
test('5a. pending settled by 20 parallel finalize, all "success" -> one settlement, commission paid once', async () => { await settleRace('ok', () => 'success'); });
test('5b. pending settled by 20 parallel finalize, all "failed" -> refunded once', async () => { await settleRace('ko', () => 'failed'); });
test('5c. pending settled by 20 parallel finalize, success and failed mixed from different sources -> exactly one settlement per row', async () => { await settleRace('mx', () => 'mixed'); });

test('5d. finalize("failed") racing the provider call of the same run(): refunded once, run reports PROVIDER_FAILED, no drift', async () => {
  const u = await mkUser('s5d', { type: T.R, wallet: 1000 });
  const slowOk = async () => { await sleep(800); return { ref: `${TAG}-late` }; };
  const run = runFor(u, svcPlain, 100, slowOk).then((v) => ({ v }), (e) => ({ e }));
  let id = null;
  for (let i = 0; i < 100 && !id; i += 1) { const t = await db('service_transactions').where({ user_id: u }).first('id'); id = t && t.id; if (!id) await sleep(10); }
  const fin = await within(20000, '5d', Promise.all(Array.from({ length: 10 }, (_, i) => pipeline.finalize(id, 'failed', { source: SOURCES[i % 4] }))));
  assert.equal(fin.filter((x) => x.changed).length, 1);
  const out = await run;
  assert.ok(out.e && out.e.code === 'PROVIDER_FAILED', `run() should see the row already failed: ${JSON.stringify(out.e && out.e.code)} ${JSON.stringify(out.v && out.v.status)}`);
  assert.equal(await bal(u), 1000, 'refunded exactly once');
  assert.equal((await db('service_transactions').where({ id }).first()).status, 'failed');
  await noProblems([u], '5d');
});

// ── 6. fund request approved in parallel ─────────────────────────────────────
let frSeq = 0;
async function mkRequest(adm, userId, amount) {
  frSeq += 1;
  return idOf((await db('fund_requests').insert({
    user_id: userId, approver_id: adm, deposit_date: '2026-01-01', payment_mode: 'Cash', amount, request_id: `${TAG}FR${frSeq}`, status: 'pending',
  }).returning('id'))[0]);
}
test('6a. 10 parallel fundRequest.act(approve) on one request -> credited once, 9 ALREADY_PROCESSED', async () => {
  const adm = await mkAdmin('s6a', 0); const u = await mkUser('s6a', { type: T.R, parent: adm, wallet: 0 });
  const id = await mkRequest(adm, u, 500);
  const res = await within(30000, '6a', Promise.allSettled(Array.from({ length: 10 }, () => fundRequest.act(id, { id: adm, role: 'admin' }, { status: 'approved' }))));
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  assert.deepEqual(count(rejectedCodes(res)), { ALREADY_PROCESSED: 9 });
  assert.equal(await bal(u), 500);
  assert.equal(Number((await db('account_transactions').where({ user_id: u, service_name: 'Fund Request' }).count('id as c').first()).c), 1);
  await noProblems([u], '6a');
});
test('6b. 10 parallel PUT /api/fund-requests/:id approve over HTTP (distinct keys) -> credited once', async () => {
  const adm = await mkAdmin('s6b', 0); const u = await mkUser('s6b', { type: T.R, parent: adm, wallet: 0 });
  const id = await mkRequest(adm, u, 750);
  const a = await apiOf(adm);
  const res = await within(30000, '6b', Promise.all(Array.from({ length: 10 }, () => a.put(`/api/fund-requests/${id}`, { status: 'approved' }))));
  assert.deepEqual(count(res.map((x) => `${x.s}${x.b.code ? `:${x.b.code}` : ''}`)), { 200: 1, '409:ALREADY_PROCESSED': 9 });
  assert.equal(await bal(u), 750);
  await noProblems([u], '6b');
});
test('6c. 5 approve + 5 reject in parallel on one request -> exactly one decision; credited only if approved', async () => {
  const adm = await mkAdmin('s6c', 0); const u = await mkUser('s6c', { type: T.R, parent: adm, wallet: 0 });
  const id = await mkRequest(adm, u, 300);
  const res = await within(30000, '6c', Promise.allSettled(Array.from({ length: 10 }, (_, i) => fundRequest.act(id, { id: adm, role: 'admin' }, { status: i % 2 ? 'rejected' : 'approved' }))));
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  const fr = await db('fund_requests').where({ id }).first();
  assert.equal(await bal(u), fr.status === 'approved' ? 300 : 0);
  await noProblems([u], '6c');
});

// ── 7. daily limit race ──────────────────────────────────────────────────────
test('7a. daily_limit 1000, 10 parallel pipeline.run of 300 (success + pending mixed) -> exactly 3 admitted, total <= 1000', async () => {
  const u = await mkUser('s7a', { type: T.R, wallet: 100000 });
  const res = await within(40000, '7a', Promise.allSettled(Array.from({ length: 10 }, (_, i) => runFor(u, svcLimit, 300, i % 2 ? pendingProvider : ok))));
  const admitted = res.filter((x) => x.status === 'fulfilled').length;
  assert.deepEqual(count(rejectedCodes(res)), { DAILY_LIMIT: 7 }, JSON.stringify(count(rejectedCodes(res))));
  assert.equal(admitted, 3);
  const used = Number((await db('service_transactions').where({ user_id: u }).whereIn('status', ['success', 'pending']).sum('amount as s').first()).s);
  assert.ok(used <= 1000, `limit 1000 exceeded: ${used}`);
  await noProblems([u], '7a');
});
test('7b. daily limit over HTTP: Mobile Recharge limit 1000, 10 parallel recharges of 300 -> 3 x 201, 7 x 400 DAILY_LIMIT', async () => {
  await db('services').where({ id: svcM.id }).update({ daily_limit: 1000 });
  try {
    const u = await mkUser('s7b', { type: T.R, wallet: 100000 });
    const a = await apiOf(u);
    const res = await within(40000, '7b', Promise.all(Array.from({ length: 10 }, () => a.post('/api/recharge/mobile', mobileBody(300)))));
    const by = count(res.map((x) => `${x.s}${x.b.code ? `:${x.b.code}` : ''}`));
    assert.deepEqual(by, { 201: 3, '400:DAILY_LIMIT': 7 }, JSON.stringify(by));
    const used = Number((await db('service_transactions').where({ user_id: u }).whereIn('status', ['success', 'pending']).sum('amount as s').first()).s);
    assert.ok(used <= 1000, `limit 1000 exceeded: ${used}`);
    await noProblems([u], '7b');
  } finally { await db('services').where({ id: svcM.id }).update({ daily_limit: 0 }); }
});

// ── 8. commission chain under load ───────────────────────────────────────────
test('8. R1,R2 -> D -> SD -> admin: 20 parallel retailer transactions -> every upline wallet == its ledger credits, none lost, margins >= 0', async () => {
  const c = await mkChain('s8', { wallets: { admin: 1000, r: 20000, d: 0, sd: 0 } });
  const res = await within(50000, '8', Promise.allSettled(Array.from({ length: 20 }, (_, i) => runFor(i % 2 ? c.r1 : c.r2, svcChain, 500))));
  assert.equal(res.filter((x) => x.status === 'fulfilled' && x.value.status === 'success').length, 20, JSON.stringify(rejectedCodes(res)));
  assert.equal(await bal(c.d), r2(20 * 5.9), 'distributor: 20 chain commissions of 5.90');
  assert.equal(await bal(c.sd), r2(20 * 5.9), 'super distributor: 20 chain commissions of 5.90');
  assert.equal(await bal(c.r1), r2(20000 - 10 * 500 + 10 * 11.8));
  assert.equal(await bal(c.r2), r2(20000 - 10 * 500 + 10 * 11.8));
  for (const [k, id] of [['d', c.d], ['sd', c.sd]]) {
    const led = await db('account_transactions').where({ user_id: id, type: 'credit' }).sum('amount as s').first();
    const com = await db('commission_ledger').where({ user_id: id, wallet_txn_type: 'credit' }).sum('net_amount as s').first();
    assert.equal(r2(led.s), r2(com.s), `${k}: wallet credits differ from the commission ledger`);
    assert.equal(Number((await db('commission_ledger').where({ user_id: id }).count('id as c').first()).c), 20, `${k}: one commission row per transaction`);
  }
  const m = await db('admin_margins').whereIn('user_id', [c.r1, c.r2]);
  assert.equal(m.length, 20); m.forEach((x) => assert.ok(Number(x.margin) >= 0, `negative margin ${x.margin}`));
  await noProblems(Object.values(c), '8');
});

// ── 9. mixed soak ────────────────────────────────────────────────────────────
test('9. soak: 100 random operations in parallel batches -> ledgers consistent, money conserved except commission / provider', async () => {
  const seed = 9090;
  const rand = rng(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const c = await mkChain('s9', { wallets: { admin: 100000, r: 3000, d: 500, sd: 500 } });
  const users = [c.adm, c.sd, c.d, c.r1, c.r2];
  const walletUsers = [c.sd, c.d, c.r1, c.r2];
  const startTotal = (await Promise.all(users.map(bal))).reduce((s, x) => s + x, 0);
  let externalCredits = 0;
  const a = await apiOf(c.r2);
  const adminApi = await apiOf(c.adm);
  const okCodes = new Set(['INSUFFICIENT_BALANCE', 'PROVIDER_DECLINED', 'ALREADY_PROCESSED']);
  const failures = [];
  const note = (label, p) => p.then((v) => v, (e) => { if (!okCodes.has(e.code)) failures.push(`${label}: ${e.code || ''} ${e.message}`); return null; });
  let done = 0;

  const pendingIds = async () => (await db('service_transactions').whereIn('user_id', walletUsers).where({ status: 'pending' }).pluck('id'));
  for (let batch = 0; batch < 5; batch += 1) {
    const pend = await pendingIds();
    const ops = [];
    for (let i = 0; i < 20; i += 1) {
      const kind = pick(['ok', 'ok', 'ok', 'decline', 'pending', 'timeout', 'tcredit', 'tdebit', 'finalize', 'finalize', 'credit', 'http', 'httptransfer']);
      const amount = 20 + Math.floor(rand() * 200);
      const who = pick([c.r1, c.r2, c.r1, c.r2, c.d]);
      if (kind === 'ok') ops.push(note('run ok', runFor(who, svcChain, amount, ok)));
      else if (kind === 'decline') ops.push(note('run declined', runFor(who, svcChain, amount, declined)));
      else if (kind === 'pending') ops.push(note('run pending', runFor(who, svcChain, amount, pendingProvider)));
      else if (kind === 'timeout') ops.push(note('run timeout', runFor(who, svcChain, amount, timedOut)));
      else if (kind === 'tcredit' || kind === 'tdebit') {
        ops.push(note('transfer', fundRepo.transfer({ fromUserId: c.adm, toUserId: pick(walletUsers), amount: 5 + Math.floor(rand() * 100), transferType: kind === 'tdebit' ? 'debit' : 'credit' })));
      } else if (kind === 'finalize' && pend.length) {
        const id = pick(pend); // the same row may be picked twice in one batch: a double settle must still be a no-op
        ops.push(note('finalize', pipeline.finalize(id, rand() > 0.5 ? 'success' : 'failed', { source: pick(SOURCES) })));
      } else if (kind === 'credit') {
        const to = pick(walletUsers); const v = 1 + Math.floor(rand() * 50); externalCredits += v;
        ops.push(note('credit', db.transaction((trx) => wallet.credit(trx, { userId: to, amount: v, service: 'QA', remark: 'soak' }))));
      } else if (kind === 'http') {
        ops.push(a.post('/api/recharge/mobile', mobileBody(10 + Math.floor(rand() * 90))).then((x) => { if (![201, 400].includes(x.s)) failures.push(`http recharge ${x.s} ${JSON.stringify(x.b)}`); }));
      } else if (kind === 'httptransfer') {
        ops.push(adminApi.post('/api/fund-transfers', { userId: c.r2, amount: 5 + Math.floor(rand() * 60), txnType: rand() > 0.5 ? 'debit' : 'credit', transactionPassword: PW }).then((x) => { if (![201, 400].includes(x.s)) failures.push(`http transfer ${x.s} ${JSON.stringify(x.b)}`); }));
      } else ops.push(Promise.resolve());
      done += 1;
    }
    await within(50000, `soak batch ${batch}`, Promise.all(ops));
  }
  assert.equal(done, 100);
  // settle everything still pending (random outcomes, in parallel)
  const left = await pendingIds();
  await within(50000, 'soak final settle', Promise.all(left.map((id) => note('finalize-end', pipeline.finalize(id, rand() > 0.5 ? 'success' : 'failed', { source: 'reconciliation' })))));
  assert.deepEqual(failures, [], `unexpected failures: ${failures.join(' | ')}`);

  await noProblems(users, '9');
  // conservation: money in the wallets changes only by what the provider took (success + still-pending debits) and the commission paid
  const txns = await db('service_transactions').whereIn('user_id', walletUsers);
  assert.equal(txns.filter((t) => t.status === 'pending').length, 0, 'everything settled');
  const providerTook = txns.filter((t) => t.status === 'success').reduce((s, t) => s + Number(t.debit_amount), 0);
  const ids = txns.map((t) => t.id);
  const commRows = await db('commission_ledger').whereIn('service_transaction_id', ids).where({ wallet_txn_type: 'credit' });
  const commission = commRows.reduce((s, x) => s + Number(x.net_amount), 0);
  const endTotal = (await Promise.all(users.map(bal))).reduce((s, x) => s + x, 0);
  assert.equal(r2(endTotal), r2(startTotal - providerTook + commission + externalCredits), `money not conserved (start ${startTotal}, end ${endTotal}, provider ${providerTook}, commission ${commission}, external ${externalCredits})`);
  // commission only for successful transactions, once per (transaction, level); margins exist exactly for successful ones
  const successIds = new Set(txns.filter((t) => t.status === 'success').map((t) => t.id));
  commRows.forEach((x) => assert.ok(successIds.has(x.service_transaction_id), `commission row ${x.id} for a non-successful transaction`));
  assert.equal(new Set(commRows.map((x) => `${x.service_transaction_id}:${x.level}`)).size, commRows.length, 'commission paid twice for one (transaction, level)');
  const margins = await db('admin_margins').whereIn('service_transaction_id', ids);
  assert.equal(margins.length, successIds.size, 'one admin_margins row per successful transaction');
  assert.equal(new Set(margins.map((m) => m.service_transaction_id)).size, margins.length);
  margins.forEach((m) => assert.ok(Number(m.margin) >= 0, `negative margin ${m.margin}`));
  const accCommission = await db('account_transactions').whereIn('user_id', walletUsers).where({ type: 'credit' }).whereRaw("service_name like '% Commission'").sum('amount as s').first();
  assert.equal(r2(accCommission.s), r2(commission), 'account history commission credits differ from commission_ledger');
  await assertAdminWalletChain(c.adm, '9');
});

// ── extra races ──────────────────────────────────────────────────────────────
test('3d. debits that overdraw: 20 parallel admin-wallet debits of 30 on 100, and 20 parallel fund-transfer debits of 30 from a 100 wallet -> 3 succeed each, never negative', async () => {
  const adm = await mkAdmin('s3d1', 100);
  const a = await apiOf(adm);
  const r1 = await within(40000, '3d admin wallet', Promise.all(Array.from({ length: 20 }, () => a.post('/api/admin-wallet/add', { amount: 30, txnType: 'debit', remark: 'qa' }))));
  assert.deepEqual(count(r1.map((x) => `${x.s}${x.b.code ? `:${x.b.code}` : ''}`)), { 201: 3, '400:ADD_FAILED': 17 });
  assert.equal(await bal(adm), 10);
  await noProblems([adm], '3d admin wallet'); await assertAdminWalletChain(adm, '3d admin wallet');

  const adm2 = await mkAdmin('s3d2', 0);
  const u = await mkUser('s3d2', { type: T.R, parent: adm2, wallet: 100 });
  const res = await within(40000, '3d fund debit', Promise.all(Array.from({ length: 20 }, () => fundRepo.transfer({ fromUserId: adm2, toUserId: u, amount: 30, transferType: 'debit' }))));
  assert.equal(res.filter((x) => x.ok).length, 3);
  assert.equal(await bal(u), 10); assert.equal(await bal(adm2), 90);
  await noProblems([u, adm2], '3d fund debit'); await assertAdminWalletChain(adm2, '3d fund debit');
});

test('3e. network panel: distributor fund transfers to a child + child and distributor transactions + admin->distributor transfers at once: no deadlock, ledgers consistent', async () => {
  const c = await mkChain('s3e', { wallets: { admin: 50000, r: 3000, d: 3000, sd: 0 } });
  const da = await apiOf(c.d);
  const rand = rng(35);
  const ops = [];
  for (let i = 0; i < 30; i += 1) ops.push(da.post('/api/network/fund-transfer', { userId: c.r1, amount: 1 + Math.floor(rand() * 150), txnType: i % 2 ? 'debit' : 'credit', transactionPassword: PW }).then((x) => { assert.ok(x.s === 201 || (x.s === 400 && x.b.code === 'TRANSFER_FAILED'), `network transfer ${x.s} ${JSON.stringify(x.b)}`); }));
  for (let i = 0; i < 15; i += 1) ops.push(runFor(c.r1, svcChain, 100 + Math.floor(rand() * 300)));
  for (let i = 0; i < 10; i += 1) ops.push(runFor(c.d, svcChain, 100 + Math.floor(rand() * 300)));
  for (let i = 0; i < 10; i += 1) ops.push(fundRepo.transfer({ fromUserId: c.adm, toUserId: c.d, amount: 1 + Math.floor(rand() * 100), transferType: i % 2 ? 'debit' : 'credit' }));
  const res = await within(50000, '3e', Promise.allSettled(ops));
  const hard = res.filter((x) => x.status === 'rejected' && x.reason.code !== 'INSUFFICIENT_BALANCE');
  assert.equal(hard.length, 0, `hard failures: ${hard.map((x) => `${x.reason.code}:${x.reason.message}`).join(' | ')}`);
  await noProblems(Object.values(c), '3e'); await assertAdminWalletChain(c.adm, '3e');
});

test('5e. pending rows settled at once from every source (signed callbacks, status-check job x3, direct finalize): exactly one settlement per row', async () => {
  const c = await mkChain('s5e', { wallets: { admin: 1000, r: 5000, d: 0, sd: 0 } });
  // the amounts are tiny (2 / 3): a flat provider commission keeps the cap from eating the upline shares
  await db('services').where({ id: svcChain.id }).update({ provider_commission_type: 'amount', provider_commission_value: 100 });
  try { await settleFromEverySource(c); } finally { await db('services').where({ id: svcChain.id }).update({ provider_commission_type: 'percentage', provider_commission_value: 100 }); }
});
async function settleFromEverySource(c) {
  const sign = (body) => crypto.createHmac('sha256', env.providerCallbackSecret).update(body).digest('hex');
  const callback = async (clientRef, status) => {
    const body = JSON.stringify({ clientRef, status });
    const r = await fetch(`${BASE}/api/provider-callback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sign(body) }, body });
    return { s: r.status, b: await r.json().catch(() => ({})) };
  };
  // amounts 2 / 3 are what the mock status check settles as success / failed
  const rows = [];
  for (const amount of [2, 3, 2, 3, 2, 3]) {
    const r = await runFor(c.r1, svcChain, amount, pendingProvider);
    rows.push({ id: (await db('service_transactions').where({ client_ref: r.clientRef }).first('id')).id, clientRef: r.clientRef, amount });
  }
  const recon = require('../src/services/reconciliation.service');
  const ops = [];
  rows.forEach((row, k) => {
    for (let i = 0; i < 4; i += 1) ops.push(callback(row.clientRef, (i + k) % 2 ? 'success' : 'failed').then((x) => { assert.equal(x.s, 200, JSON.stringify(x.b)); }));
    for (let i = 0; i < 3; i += 1) ops.push(pipeline.finalize(row.id, (i + k) % 2 ? 'failed' : 'success', { source: SOURCES[i] }));
  });
  for (let i = 0; i < 3; i += 1) ops.push(recon.runStatusChecks({ minAgeSec: 0, limit: 500 }));
  const res = await within(50000, '5e', Promise.allSettled(ops));
  assert.equal(res.filter((x) => x.status === 'rejected').length, 0, JSON.stringify(res.filter((x) => x.status === 'rejected').map((x) => x.reason.message)));
  const txns = await db('service_transactions').whereIn('id', rows.map((x) => x.id));
  assert.equal(txns.filter((t) => t.status === 'pending').length, 0, 'every row is settled');
  const success = txns.filter((t) => t.status === 'success');
  const failed = txns.filter((t) => t.status === 'failed');
  const comm = await db('commission_ledger').whereIn('service_transaction_id', rows.map((x) => x.id));
  assert.equal(comm.length, success.length * 3, 'R + D + SD commission rows once per successful row');
  assert.equal(new Set(comm.map((x) => `${x.service_transaction_id}:${x.level}`)).size, comm.length);
  assert.equal((await db('admin_margins').whereIn('service_transaction_id', rows.map((x) => x.id))).length, success.length);
  assert.equal(Number((await db('account_transactions').where({ user_id: c.r1, type: 'credit' }).whereRaw("remark like 'Refund%'").count('id as c').first()).c), failed.length, 'one refund per failed row');
  await noProblems(Object.values(c), '5e');
}

test('5f. finalize("success") x10 racing the same run()\'s provider answer: commission paid once, run still returns', async () => {
  const c = await mkChain('s5f', { wallets: { admin: 1000, r: 5000, d: 0, sd: 0 } });
  const slowOk = async () => { await sleep(800); return { ref: `${TAG}-late` }; };
  const run = runFor(c.r1, svcChain, 500, slowOk).then((v) => ({ v }), (e) => ({ e }));
  let id = null;
  for (let i = 0; i < 100 && !id; i += 1) { const t = await db('service_transactions').where({ user_id: c.r1 }).first('id'); id = t && t.id; if (!id) await sleep(10); }
  const fin = await within(20000, '5f', Promise.all(Array.from({ length: 10 }, (_, i) => pipeline.finalize(id, 'success', { source: SOURCES[i % 4] }))));
  assert.equal(fin.filter((x) => x.changed).length, 1);
  const out = await run;
  assert.ok(out.v && out.v.status === 'success', `run() should report the settled success: ${JSON.stringify(out.e && out.e.code)}`);
  assert.equal(await bal(c.r1), r2(5000 - 500 + 11.8)); assert.equal(await bal(c.d), 5.9); assert.equal(await bal(c.sd), 5.9);
  assert.equal(Number((await db('commission_ledger').where({ service_transaction_id: id }).count('id as c').first()).c), 3);
  await noProblems(Object.values(c), '5f');
});

test('6d. 10 parallel fund requests with the same UTR -> exactly one created', async () => {
  if (!bankId) bankId = idOf((await db('company_banks').insert({ bank_name: `${TAG} bank`, account_holder: 'QA', account_no: '000111222', ifsc_code: 'QAQA0000001' }).returning('id'))[0]);
  const u = await mkUser('s6d', { type: T.R, wallet: 0 });
  const body = { amount: 100, paymentMode: 'NEFT', utr: `UTR${Date.now()}`, depositDate: '2026-01-01', companyBankId: bankId };
  const res = await within(30000, '6d', Promise.allSettled(Array.from({ length: 10 }, () => fundRequest.create(u, body))));
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1, JSON.stringify(count(rejectedCodes(res))));
  assert.deepEqual(count(rejectedCodes(res)), { DUPLICATE_UTR: 9 });
  assert.equal(Number((await db('fund_requests').where({ user_id: u }).count('id as c').first()).c), 1);
});

test('8b. commission cap under load: provider pays 2% (10 on 500) but slabs ask for more -> 20 parallel transactions, margin never negative, paid <= provider commission', async () => {
  await db('services').where({ id: svcChain.id }).update({ provider_commission_value: 2 });
  try {
    const c = await mkChain('s8b', { wallets: { admin: 1000, r: 20000, d: 0, sd: 0 } });
    const res = await within(50000, '8b', Promise.allSettled(Array.from({ length: 20 }, (_, i) => runFor(i % 2 ? c.r1 : c.r2, svcChain, 500))));
    assert.equal(res.filter((x) => x.status === 'fulfilled').length, 20, JSON.stringify(rejectedCodes(res)));
    const m = await db('admin_margins').whereIn('user_id', [c.r1, c.r2]);
    assert.equal(m.length, 20);
    m.forEach((x) => { assert.ok(Number(x.margin) >= 0, `negative margin ${x.margin}`); assert.ok(Number(x.commission_paid) <= Number(x.provider_commission), `paid ${x.commission_paid} > provider ${x.provider_commission}`); });
    await noProblems(Object.values(c), '8b');
  } finally { await db('services').where({ id: svcChain.id }).update({ provider_commission_value: 100 }); }
});

// ── fault injection: the provider call succeeded, then the settle step fails ──
test('10. [BUG] a 500 raised AFTER the provider call frees the Idempotency-Key: the retry calls the provider and debits AGAIN', async () => {
  const u = await mkUser('s10', { type: T.R, wallet: 1000 });
  const a = await apiOf(u);
  const fn = `qa_fail_${TAG}`;
  await db.raw(`create or replace function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'qa injected failure while settling'; end $$`);
  await db.raw(`create trigger ${fn} before insert on admin_margins for each row when (NEW.user_id = ${u}) execute function ${fn}()`);
  const key = `${TAG}-10`;
  let first; let second;
  try {
    first = await a.post('/api/recharge/mobile', mobileBody(100), { 'Idempotency-Key': key });
  } finally {
    await db.raw(`drop trigger if exists ${fn} on admin_margins`);
    await db.raw(`drop function if exists ${fn}()`);
  }
  assert.ok(first.s >= 500, `fault injection did not reach the settle step (${first.s} ${JSON.stringify(first.b)})`);
  assert.equal(await bal(u), 900, 'the money is held (provider was called)');
  await sleep(200);
  second = await a.post('/api/recharge/mobile', mobileBody(100), { 'Idempotency-Key': key }); // the client retries after the 500, same key
  const attempts = Number((await db('service_transactions').where({ user_id: u }).count('id as c').first()).c);
  // The provider was already called for the first attempt (its answer was lost with the failed settle): a retry with the SAME key must not call it again.
  assert.equal(attempts, 1, `provider called ${attempts} times for one Idempotency-Key (first ${first.s}, retry ${second.s}); wallet now ${await bal(u)}`);
  assert.equal(await bal(u), 900);
});

test('11. [BUG] an amount with more than 2 decimals is accepted by the money pipeline (the provider is told one amount, the wallet is debited another)', async () => {
  const u = await mkUser('s11', { type: T.R, wallet: 1000 });
  const a = await apiOf(u);
  const r = await a.post('/api/recharge/mobile', mobileBody(10.004));
  const row = await db('service_transactions').where({ user_id: u }).first();
  assert.equal(r.s, 400, `10.004 was accepted (${r.s}); stored amount ${row && row.amount}, wallet ${await bal(u)}`);
  assert.equal(r.b.code, 'INVALID_AMOUNT');
});
