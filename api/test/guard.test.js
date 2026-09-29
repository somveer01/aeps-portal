'use strict';

// Transaction guards (KYC, service on, service access, daily limit) through the real
// pipeline and the catalogue, on a throwaway service + user.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, signFor } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');

const PORT = 3900;
const BASE = `http://localhost:${PORT}`;
const TAG = `grd${Date.now()}`;
let server; let svc; let userId; let recharge;
const ok = () => Promise.resolve({ ref: `${TAG}-ref` });
const fail = () => Promise.reject(Object.assign(new Error('declined'), { status: 402, code: 'PROVIDER_DECLINED' }));
const run = (amount, providerCall = ok, service = svc.title) => pipeline.run({ user: { id: userId }, service, amount, providerCall });
const setUser = (patch) => db('users').where({ id: userId }).update(patch);
const setSvc = (patch) => db('services').where({ id: svc.id }).update(patch);
const balance = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);

before(async () => {
  server = await startServer(PORT);
  const cat = await db('service_categories').orderBy('id').first('id');
  const [s] = await db('services').insert({ title: `${TAG} Service`, service_category_id: cat.id, is_active: true }).returning(['id', 'title']);
  svc = s;
  recharge = await db('services').whereRaw("lower(title) = 'mobile recharge'").first('id', 'title');
  const ut = await db('user_types').orderBy('id').first('id');
  const [u] = await db('users').insert({
    username: TAG, user_code: TAG, password_hash: 'x', mobile: '9000000000', full_name: 'Guard Test', role: 'user',
    user_type_id: ut.id, wallet_balance: 10000, kyc_status: 'pending',
  }).returning('id');
  userId = typeof u === 'object' ? u.id : u;
});

after(async () => {
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('users').where({ id: userId }).del();
  await db('services').where({ id: svc.id }).del();
  server.close();
  await db.destroy();
});

test('KYC must be verified; nothing is debited when blocked', async () => {
  await assert.rejects(run(100), (e) => e.code === 'KYC_REQUIRED');
  assert.equal(await balance(), 10000);
  await setUser({ kyc_status: 'rejected' });
  await assert.rejects(run(100), (e) => e.code === 'KYC_REQUIRED');
  await setUser({ kyc_status: 'verified' });
  await run(100);
  assert.equal(await balance(), 9900);
});

test('a service switched off in Service Master is blocked', async () => {
  await setSvc({ is_active: false });
  await assert.rejects(run(100), (e) => e.code === 'SERVICE_OFF' && e.status === 403);
  await setSvc({ is_active: true });
});

test('service access: empty list allows all, a list allows only its services', async () => {
  await setUser({ service_access: JSON.stringify([recharge ? recharge.id : -1]) });
  await assert.rejects(run(100), (e) => e.code === 'NO_SERVICE_ACCESS');
  await setUser({ service_access: JSON.stringify([svc.id]) });
  await run(100);
  await setUser({ service_access: null });
  await run(100);
});

test('daily limit counts only today\'s successful transactions', async () => {
  await setSvc({ daily_limit: 1000 });
  await db('service_transactions').where({ user_id: userId }).del(); // start the day clean
  await run(600);
  await assert.rejects(run(500), (e) => e.code === 'DAILY_LIMIT' && /₹400\.00/.test(e.message));
  await assert.rejects(run(400, fail), (e) => e.code === 'PROVIDER_DECLINED');
  await run(400); // the failed one did not use up the limit
  await assert.rejects(run(1), (e) => e.code === 'DAILY_LIMIT');
  await setSvc({ daily_limit: 0 });
  await run(1);
});

test('a service not in Service Master only needs KYC', async () => {
  await run(50, ok, `${TAG} Unlisted Service`);
});

test('catalogue hides services the user cannot use; Fund Request always shows', async () => {
  if (!recharge) return;
  const token = signFor(await db('users').where({ id: userId }).first());
  await setUser({ service_access: JSON.stringify([recharge.id]) });
  const c = await api(BASE, token).get('/api/services/catalogue');
  const titles = c.b.b2b.map((t) => t.title);
  assert.ok(titles.includes('Mobile Recharge'));
  assert.ok(!titles.includes('DTH Recharge'), 'no access to DTH');
  assert.ok(titles.includes('Fund Request'));
  await setUser({ service_access: null });
  const all = await api(BASE, token).get('/api/services/catalogue');
  assert.ok(all.b.b2b.length > titles.length);
});
