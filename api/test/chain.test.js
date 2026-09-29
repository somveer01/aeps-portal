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
    full_name: `Chain ${key}`, role: 'user', user_type_id: ut.id, plan_id: planId, parent_id: parentId, wallet_balance: wallet, kyc_status: 'verified',
  }).returning('id');
  users[key] = { id: typeof row === 'object' ? row.id : row, userTypeId: ut.id };
}

async function mkSlab(key, typeName, commissionType, value, chainType, { txnType = 'credit', operator = null, specificUser = null } = {}) {
  const ut = await db('user_types').where({ name: typeName }).first('id');
  const [row] = await db('commission_slots').insert({
    user_type_id: ut.id, service_id: svc.id, plan_id: planId, commission_type: commissionType, value,
    min_amount: 1, max_amount: 10000, chain_type: chainType, txn_type: txnType, is_active: true,
    operator, specific_user: specificUser,
  }).returning('id');
  slabs[key] = typeof row === 'object' ? row.id : row;
}

let origProviderCommission;
before(async () => {
  svc = await db('services').orderBy('id').first('id', 'title');
  origProviderCommission = await db('services').where({ id: svc.id }).first('provider_commission_type', 'provider_commission_value');
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
  await db('services').where({ id: svc.id }).update(origProviderCommission);
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

const txnLedger = (serviceTransactionId) => db('commission_ledger').where({ service_transaction_id: serviceTransactionId });
const lastTxnId = async () => (await db('service_transactions').where({ user_id: users.R.id, status: 'success' }).orderBy('id', 'desc').first('id')).id;

test('admin margin = provider commission + charges − commission paid', async () => {
  await db('services').where({ id: svc.id }).update({ provider_commission_type: 'percentage', provider_commission_value: 3 });
  await pipeline.run({ user: { id: users.R.id }, service: svc.title, amount: AMOUNT, providerCall: ok });
  const txnId = await lastTxnId();
  const paid = (await txnLedger(txnId)).filter((r) => r.wallet_txn_type === 'credit').reduce((s, r) => s + Number(r.net_amount), 0);
  const m = await db('admin_margins').where({ service_transaction_id: txnId }).first();
  assert.ok(m, 'margin row written');
  assert.equal(Number(m.provider_commission), 15); // 3% of 500
  assert.equal(Number(m.charges_collected), 0);
  assert.equal(Number(m.commission_paid), Math.round(paid * 100) / 100);
  assert.equal(Number(m.margin), Math.round((15 - paid) * 100) / 100);
});

test('debit slab takes a service charge from the wallet; failure refunds it too', async () => {
  await mkSlab('Rdebit', 'Retailer', 'amount', 10, 'self', { txnType: 'debit', operator: 'TESTOP' });
  const fee = computeAmounts({ commissionType: 'amount', value: 10, amount: AMOUNT }); // 10 + 1.8 GST
  const rBefore = await balance(users.R.id);
  const r = await pipeline.run({ user: { id: users.R.id }, service: svc.title, operator: 'TESTOP', amount: AMOUNT, providerCall: ok });
  assert.equal(r.commission, 0);
  assert.equal(r.charge, fee.net);
  assert.equal(await balance(users.R.id), Math.round((rBefore - AMOUNT - fee.net) * 100) / 100);
  const txnId = await lastTxnId();
  const own = (await txnLedger(txnId)).find((row) => row.user_id === users.R.id);
  assert.equal(own.wallet_txn_type, 'debit');
  assert.equal(Number(own.updated_balance), Math.round((rBefore - AMOUNT - fee.net) * 100) / 100);
  assert.equal(Number((await db('admin_margins').where({ service_transaction_id: txnId }).first()).charges_collected), fee.net);
  assert.ok(await db('account_transactions').where({ user_id: users.R.id, service_name: `${svc.title} Charge` }).first(), 'charge ledger entry');

  const mid = await balance(users.R.id);
  await assert.rejects(pipeline.run({ user: { id: users.R.id }, service: svc.title, operator: 'TESTOP', amount: AMOUNT, providerCall: fail }));
  assert.equal(await balance(users.R.id), mid, 'amount + charge refunded');
});

test('operator slab matches the operator or the transfer mode, and nothing else', async () => {
  const fee = computeAmounts({ commissionType: 'amount', value: 10, amount: AMOUNT });
  let before = await balance(users.R.id);
  const byMode = await pipeline.run({ user: { id: users.R.id }, service: svc.title, operator: 'Some Bank (TESTOP)', mode: 'testop', amount: AMOUNT, providerCall: ok });
  assert.equal(byMode.charge, fee.net, 'mode matched case-insensitively');
  assert.equal(await balance(users.R.id), Math.round((before - AMOUNT - fee.net) * 100) / 100);

  before = await balance(users.R.id);
  const other = await pipeline.run({ user: { id: users.R.id }, service: svc.title, operator: 'OTHER', amount: AMOUNT, providerCall: ok });
  const own = computeAmounts({ commissionType: 'percentage', value: 2, amount: AMOUNT });
  assert.equal(other.charge, 0, 'operator slab skipped');
  assert.equal(other.commission, own.net, 'generic slab used instead');
  await db('commission_slots').where({ id: slabs.Rdebit }).del();
});

test('a slab for a specific user wins over the general slab', async () => {
  const code = (await db('users').where({ id: users.R.id }).first('user_code')).user_code;
  await mkSlab('Rspecial', 'Retailer', 'percentage', 4, 'self', { specificUser: code.toUpperCase() });
  const r = await pipeline.run({ user: { id: users.R.id }, service: svc.title, amount: AMOUNT, providerCall: ok });
  assert.equal(r.commission, computeAmounts({ commissionType: 'percentage', value: 4, amount: AMOUNT }).net);
  // Another user of the same type does not get it.
  const slab = await require('../src/services/commission.service').findSlab({ userTypeId: users.R.userTypeId, planId, serviceName: svc.title, amount: AMOUNT, userCode: 'someone-else' });
  assert.equal(Number(slab.value), 2);
  await db('commission_slots').where({ id: slabs.Rspecial }).del();
});
