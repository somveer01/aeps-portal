'use strict';

// Transaction guards (KYC, service on, service permission, daily limit) through the real
// pipeline and the catalogue, on a throwaway service + user.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, signFor } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');

const PORT = 3900;
const BASE = `http://localhost:${PORT}`;
const TAG = `grd${Date.now()}`;
let server; let svc; let userId; let recharge; let typeId;
const ok = () => Promise.resolve({ ref: `${TAG}-ref` });
const fail = () => Promise.reject(Object.assign(new Error('declined'), { status: 402, code: 'PROVIDER_DECLINED' }));
const run = (amount, providerCall = ok, service = svc.title) => pipeline.run({ user: { id: userId }, service, amount, providerCall });
const setUser = (patch) => db('users').where({ id: userId }).update(patch);
const setSvc = (patch) => db('services').where({ id: svc.id }).update(patch);
const allowUser = (serviceId, allowed = true) => db('user_service_overrides').insert({ user_id: userId, service_id: serviceId, allowed }).onConflict(['user_id', 'service_id']).merge(['allowed']);
const balance = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);

before(async () => {
  server = await startServer(PORT);
  const cat = await db('service_categories').orderBy('id').first('id');
  const [s] = await db('services').insert({ title: `${TAG} Service`, service_category_id: cat.id, is_active: true }).returning(['id', 'title']);
  svc = s;
  recharge = await db('services').whereRaw("lower(title) = 'mobile recharge'").first('id', 'title');
  const ut = await db('user_types').orderBy('id').first('id');
  typeId = ut.id;
  const [u] = await db('users').insert({
    username: TAG, user_code: TAG, password_hash: 'x', mobile: '9000000000', full_name: 'Guard Test', role: 'user',
    user_type_id: ut.id, wallet_balance: 10000, kyc_status: 'pending',
  }).returning('id');
  userId = typeof u === 'object' ? u.id : u;
  await allowUser(svc.id); // Service Permissions: this user may use the test service
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

test('service permission: user override beats the type default', async () => {
  const typeRow = { user_type_id: typeId, service_id: svc.id };
  await db('user_service_overrides').where({ user_id: userId, service_id: svc.id }).del();
  await db('user_type_services').where(typeRow).del();
  await assert.rejects(run(100), (e) => e.code === 'NO_SERVICE_ACCESS' && e.status === 403, 'type not allowed, no override');
  await db('user_type_services').insert(typeRow);
  await run(100); // type default allows
  await allowUser(svc.id, false);
  await assert.rejects(run(100), (e) => e.code === 'NO_SERVICE_ACCESS', 'user block beats type allow');
  await db('user_type_services').where(typeRow).del();
  await allowUser(svc.id, true);
  await run(100); // user allow beats type deny
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
  await allowUser(recharge.id);
  const c = await api(BASE, token).get('/api/services/catalogue');
  const titles = c.b.b2b.map((t) => t.title);
  assert.ok(titles.includes('Mobile Recharge'));
  assert.ok(!titles.includes('DTH Recharge'), 'no access to DTH');
  assert.ok(titles.includes('Fund Request'));
  const dth = await db('services').whereRaw("lower(title) = 'dth recharge'").first('id');
  if (dth) await allowUser(dth.id);
  const all = await api(BASE, token).get('/api/services/catalogue');
  assert.ok(all.b.b2b.length > titles.length);
});
