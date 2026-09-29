'use strict';

// Chain commission through the real money pipeline on the dev DB. Everything is
// created under a throwaway plan and removed afterwards.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/config/db');
const pipeline = require('../src/services/txnPipeline.service');
const { computeAmounts } = require('../src/services/commission.service');

const TAG = `chain${Date.now()}`;
const AMOUNT = 500;
let svc; let planId; const users = {}; const slabs = {};

const balance = async (id) => Number((await db('users').where({ id }).first('wallet_balance')).wallet_balance);
const ledger = (userId) => db('commission_ledger').where({ user_id: userId }).orderBy('id');
const ok = () => Promise.resolve({ ref: `${TAG}-ref` });
const fail = () => Promise.reject(Object.assign(new Error('declined'), { status: 402, code: 'PROVIDER_DECLINED' }));

async function mkUser(key, typeName, parentId, wallet) {
  const ut = await db('user_types').where({ name: typeName }).first('id');
  const [row] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: 'x', mobile: '9000000000',
    full_name: `Chain ${key}`, role: 'user', user_type_id: ut.id, plan_id: planId, parent_id: parentId, wallet_balance: wallet,
  }).returning('id');
  users[key] = { id: typeof row === 'object' ? row.id : row, userTypeId: ut.id };
}

async function mkSlab(key, typeName, commissionType, value, chainType) {
  const ut = await db('user_types').where({ name: typeName }).first('id');
  const [row] = await db('commission_slots').insert({
    user_type_id: ut.id, service_id: svc.id, plan_id: planId, commission_type: commissionType, value,
    min_amount: 1, max_amount: 10000, chain_type: chainType, txn_type: 'credit', is_active: true,
  }).returning('id');
  slabs[key] = typeof row === 'object' ? row.id : row;
}

before(async () => {
  svc = await db('services').orderBy('id').first('id', 'title');
  const ut = await db('user_types').where({ name: 'Retailer' }).first('id');
  const [p] = await db('plans').insert({ user_type_id: ut.id, name: `${TAG} plan` }).returning('id');
  planId = typeof p === 'object' ? p.id : p;
  // Master Distributor → Distributor → Retailer
  await mkUser('MD', 'Super Distributor', null, 0);
  await mkUser('D', 'Distributor', users.MD.id, 0);
  await mkUser('R', 'Retailer', users.D.id, 5000);
  await mkSlab('R', 'Retailer', 'percentage', 2, 'self');
  await mkSlab('D', 'Distributor', 'amount', 5, 'chain');
  await mkSlab('MD', 'Super Distributor', 'percentage', 1, 'self'); // self: must NOT pay on the retailer's txn
});

after(async () => {
  const ids = Object.values(users).map((u) => u.id);
  await db('commission_ledger').whereIn('user_id', ids).del();
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('service_transactions').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).del();
  await db('commission_slots').whereIn('id', Object.values(slabs)).del();
  await db('plans').where({ id: planId }).del();
  await db.destroy();
});

test('retailer txn pays retailer + chain upline; self slab above is skipped', async () => {
  const r = await pipeline.run({ user: { id: users.R.id }, service: svc.title, amount: AMOUNT, providerCall: ok });
  const own = computeAmounts({ commissionType: 'percentage', value: 2, amount: AMOUNT }); // 10 + 1.8 GST
  const dist = computeAmounts({ commissionType: 'amount', value: 5, amount: AMOUNT }); // 5 + 0.9 GST

  assert.equal(r.commission, own.net);
  assert.equal(await balance(users.R.id), 5000 - AMOUNT + own.net);
  assert.equal(await balance(users.D.id), dist.net);
  assert.equal(await balance(users.MD.id), 0);

  const [dRow] = await ledger(users.D.id);
  assert.equal(dRow.level, 1);
  assert.equal(dRow.source_user_id, users.R.id);
  assert.ok(dRow.service_transaction_id, 'linked to the service transaction');
  assert.equal(Number(dRow.updated_balance), dist.net);
  const [rRow] = await ledger(users.R.id);
  assert.equal(rRow.level, 0);
  assert.equal(Number(rRow.updated_balance), 5000 - AMOUNT + own.net);
  assert.ok(await db('account_transactions').where({ user_id: users.D.id, type: 'credit' }).first(), 'upline wallet ledger entry');
});

test('chain slab two levels up pays level 2', async () => {
  await db('commission_slots').where({ id: slabs.MD }).update({ chain_type: 'chain' });
  const mdBefore = await balance(users.MD.id);
  await pipeline.run({ user: { id: users.R.id }, service: svc.title, amount: AMOUNT, providerCall: ok });
  const md = computeAmounts({ commissionType: 'percentage', value: 1, amount: AMOUNT });
  assert.equal(await balance(users.MD.id), mdBefore + md.net);
  const rows = await ledger(users.MD.id);
  assert.equal(rows[rows.length - 1].level, 2);
});

test('blocked upline is skipped but the chain continues above it', async () => {
  await db('users').where({ id: users.D.id }).update({ is_active: false });
  const dBefore = await balance(users.D.id); const mdBefore = await balance(users.MD.id);
  await pipeline.run({ user: { id: users.R.id }, service: svc.title, amount: AMOUNT, providerCall: ok });
  assert.equal(await balance(users.D.id), dBefore);
  assert.ok(await balance(users.MD.id) > mdBefore, 'MD still paid');
  await db('users').where({ id: users.D.id }).update({ is_active: true });
});

test('failed txn: refund, no commission for anyone', async () => {
  const counts = async () => Number((await db('commission_ledger').whereIn('user_id', Object.values(users).map((u) => u.id)).count('id as c').first()).c);
  const before = await counts(); const rBefore = await balance(users.R.id);
  await assert.rejects(pipeline.run({ user: { id: users.R.id }, service: svc.title, amount: AMOUNT, providerCall: fail }));
  assert.equal(await counts(), before);
  assert.equal(await balance(users.R.id), rBefore);
});

test('a user with a plan only matches that plan\'s slabs', async () => {
  const other = await db('plans').where('id', '!=', planId).first('id');
  await db('users').where({ id: users.D.id }).update({ plan_id: other.id });
  const dBefore = await balance(users.D.id);
  await pipeline.run({ user: { id: users.R.id }, service: svc.title, amount: AMOUNT, providerCall: ok });
  assert.equal(await balance(users.D.id), dBefore, 'no slab on the distributor\'s own plan → nothing paid');
  await db('users').where({ id: users.D.id }).update({ plan_id: planId });
});
