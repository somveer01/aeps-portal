'use strict';

// The money pipeline in three steps (A hold + record, B call the provider with NO lock, C settle by the answer).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');
const wallet = require('../src/services/wallet.service');
const recon = require('../src/services/reconciliation.service');
const providers = require('../src/services/providers.service');
const { findProblems } = require('../src/services/ledgerCheck.service');

const TAG = `pp${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let typeId; let svc; let userId;

const bal = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);
const txn = (ref) => db('service_transactions').where({ client_ref: ref }).first();
const clean = async () => {
  await db('commission_ledger').where({ user_id: userId }).del();
  await db('admin_margins').where({ user_id: userId }).del();
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('users').where({ id: userId }).update({ wallet_balance: 1000 });
};
// A pending row as the pipeline leaves it, with its debit on the wallet and ledger (so refunds balance).
async function seedPending(ref, { stage, ageMinutes = 10, amount = 100 }) {
  await db.transaction(async (trx) => {
    await wallet.debit(trx, { userId, amount, service: svc.title, remark: 'seed' });
    await trx('service_transactions').insert({
      user_id: userId, service: svc.title, amount, debit_amount: amount, client_ref: ref, status: 'pending', stage,
      created_at: trx.raw(`now() - interval '${ageMinutes} minutes'`),
    });
  });
}

before(async () => {
  typeId = idOf((await db('user_types').insert({ name: `${TAG} type` }).returning('id'))[0]);
  const cat = await db('service_categories').orderBy('id').first('id');
  svc = (await db('services').insert({ title: `${TAG} Recharge`, service_category_id: cat.id, is_active: true, provider_commission_type: 'percentage', provider_commission_value: 100 }).returning(['id', 'title']))[0];
  await db('user_type_services').insert({ user_type_id: typeId, service_id: svc.id });
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Phases', role: 'user', user_type_id: typeId, wallet_balance: 1000, kyc_status: 'verified',
  }).returning('id'))[0]);
});

after(async () => {
  await clean();
  await db('users').where({ id: userId }).del();
  await db('user_type_services').where({ user_type_id: typeId }).del();
  await db('services').where({ id: svc.id }).del();
  await db('user_types').where({ id: typeId }).del();
  await db.destroy();
});

test('the attempt is on record, money held and the wallet UNLOCKED while the provider is being called', async () => {
  await clean();
  let during;
  const providerCall = async (clientRef) => {
    // Another connection reads the row, then changes this very wallet. With a lock held across the provider call this
    // would wait forever (the call waits for us, the transaction waits for the call).
    during = { row: await txn(clientRef), wallet: await bal() };
    await Promise.race([
      db.transaction((trx) => wallet.credit(trx, { userId, amount: 5, service: 'Test', remark: 'while the provider is busy' })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('the wallet was locked during the provider call')), 5000)),
    ]);
    return { ref: `${TAG}-ref` };
  };
  const r = await pipeline.run({ user: { id: userId }, service: svc.title, amount: 100, providerCall });
  assert.equal(r.status, 'success');
  assert.equal(during.row.status, 'pending'); assert.equal(during.row.stage, 'initiated', 'recorded BEFORE the provider was called');
  assert.equal(during.wallet, 900, 'already debited');
  const done = await txn(r.clientRef);
  assert.equal(done.status, 'success'); assert.equal(done.stage, null);
  assert.equal(await bal(), 905, 'the credit made during the call was not overwritten');
  assert.deepEqual(await findProblems({ userIds: [userId] }), []);
});

test('the error rule: 4xx or an explicit flag is a definite refusal; timeouts, network errors and 5xx are not', () => {
  const { isDefiniteFailure } = pipeline;
  assert.equal(isDefiniteFailure(Object.assign(new Error('x'), { status: 402 })), true);
  assert.equal(isDefiniteFailure(Object.assign(new Error('x'), { definite: true, status: 503 })), true);
  assert.equal(isDefiniteFailure(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), false);
  assert.equal(isDefiniteFailure(Object.assign(new Error('x'), { status: 502 })), false);
  assert.equal(isDefiniteFailure(new TypeError('adapter bug')), false);
  assert.equal(isDefiniteFailure(null), false);
});

test('the status check refunds an attempt the provider never received (crash / timeout) and leaves everything else alone', async () => {
  await clean();
  await seedPending(`${TAG}-old-init`, { stage: 'initiated', ageMinutes: 10 });
  await seedPending(`${TAG}-fresh-init`, { stage: 'initiated', ageMinutes: 0 });
  await seedPending(`${TAG}-unknown`, { stage: 'unknown', ageMinutes: 10 });
  await seedPending(`${TAG}-acked`, { stage: null, ageMinutes: 10 });
  assert.equal(await bal(), 600);

  const original = providers.status;
  providers.status = async ({ clientRef }) => (String(clientRef).startsWith(TAG) ? { status: 'notfound' } : { status: 'pending' });
  try { await recon.runStatusChecks({ minAgeSec: 0, limit: 200 }); } finally { providers.status = original; }

  assert.equal((await txn(`${TAG}-old-init`)).status, 'failed', 'a crashed attempt the provider never saw is refunded');
  assert.equal((await txn(`${TAG}-unknown`)).status, 'failed', 'a timed-out attempt the provider never saw is refunded');
  assert.equal((await txn(`${TAG}-fresh-init`)).status, 'pending', 'a call that may still be running is not touched for 5 minutes');
  assert.equal((await txn(`${TAG}-acked`)).status, 'pending', 'the provider acknowledged it: "not found" does not refund');
  assert.equal(await bal(), 800, 'exactly the two refunds came back');
  assert.deepEqual(await findProblems({ userIds: [userId] }), []);
});

test('a pending row settles exactly once whichever way it is settled', async () => {
  await clean();
  await seedPending(`${TAG}-once`, { stage: 'unknown', ageMinutes: 10 });
  const row = await txn(`${TAG}-once`);
  assert.equal((await pipeline.finalize(row.id, 'failed', { source: 'status_check' })).changed, true);
  assert.equal((await pipeline.finalize(row.id, 'failed', { source: 'callback' })).changed, false);
  assert.equal((await pipeline.finalize(row.id, 'success', { source: 'admin' })).changed, false, 'a settled row never flips');
  assert.equal(await bal(), 1000);
  assert.equal((await txn(`${TAG}-once`)).stage, null);
  assert.deepEqual(await findProblems({ userIds: [userId] }), []);
});
