'use strict';

// Where the money comes from / goes to on every ADMIN fund move: the Users Manager "Fund wallet" icon and the Fund Transfer
// screen are one zero-sum move (admin wallet <-> user wallet) with ledger rows on both sides. Throwaway user, restored afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');

const PORT = 3894;
const BASE = `http://localhost:${PORT}`;
const TAG = `ff${Date.now()}`;
let server; let admin; let adminToken; let typeId; let userId; let startAdminBal; let marks;
const wallet = async (id) => Number((await db('users').where({ id }).first('wallet_balance')).wallet_balance);
const maxId = async (table) => Number((await db(table).max('id as m').first()).m || 0);

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  adminToken = signFor(admin);
  const [t] = await db('user_types').insert({ name: `${TAG} type` }).returning('id');
  typeId = typeof t === 'object' ? t.id : t;
  const [u] = await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Fund Flow', role: 'user', user_type_id: typeId, wallet_balance: 50,
  }).returning('id');
  userId = typeof u === 'object' ? u.id : u;
  // Make sure the admin can pay: top the admin wallet up for the test, put it back afterwards.
  startAdminBal = await wallet(admin.id);
  await db('users').where({ id: admin.id }).update({ wallet_balance: startAdminBal + 1000 });
  marks = { at: await maxId('account_transactions'), aw: await maxId('admin_wallet_transactions'), ft: await maxId('fund_transfers') };
});

after(async () => {
  await db('account_transactions').where('id', '>', marks.at).whereIn('user_id', [admin.id, userId]).del();
  await db('admin_wallet_transactions').where('id', '>', marks.aw).where({ admin_id: admin.id }).del();
  await db('fund_transfers').where('id', '>', marks.ft).where({ to_user_id: userId }).del();
  await db('idempotency_keys').whereIn('user_id', [admin.id, userId]).del();
  await db('audit_log').whereIn('user_id', [admin.id, userId]).where('created_at', '>', new Date(Date.now() - 3600 * 1000)).where({ event: 'user_wallet_fund' }).del();
  await db('users').where({ id: userId }).del();
  await db('user_types').where({ id: typeId }).del();
  await db('users').where({ id: admin.id }).update({ wallet_balance: startAdminBal });
  server.close();
  await db.destroy();
});

test('Users Manager credit takes the amount from the admin wallet and writes the ledger on both sides', async () => {
  const adminBefore = await wallet(admin.id);
  const r = await api(BASE, adminToken).post(`/api/users/${userId}/fund`, { amount: 120.5, type: 'credit' });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(await wallet(userId), 170.5, 'user +120.50');
  assert.equal(await wallet(admin.id), adminBefore - 120.5, 'admin -120.50 (zero-sum)');

  const userRows = await db('account_transactions').where('id', '>', marks.at).where({ user_id: userId });
  assert.equal(userRows.length, 1);
  assert.equal(userRows[0].type, 'credit'); assert.equal(Number(userRows[0].updated_balance), 170.5);
  const adminRows = await db('account_transactions').where('id', '>', marks.at).where({ user_id: admin.id });
  assert.equal(adminRows.length, 1);
  assert.equal(adminRows[0].type, 'debit'); assert.equal(Number(adminRows[0].before_balance), adminBefore);
  const aw = await db('admin_wallet_transactions').where('id', '>', marks.aw).where({ admin_id: admin.id });
  assert.equal(aw.length, 1, 'admin Wallet History shows the move');
  assert.equal(aw[0].txn_type, 'debit'); assert.equal(Number(aw[0].updated_balance), adminBefore - 120.5);
  assert.equal((await db('fund_transfers').where('id', '>', marks.ft).where({ to_user_id: userId })).length, 1, 'a fund_transfers record');
});

test('Users Manager debit gives the amount back to the admin wallet', async () => {
  const adminBefore = await wallet(admin.id);
  const r = await api(BASE, adminToken).post(`/api/users/${userId}/fund`, { amount: 20.5, type: 'debit' });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(await wallet(userId), 150, 'user -20.50');
  assert.equal(await wallet(admin.id), adminBefore + 20.5, 'admin +20.50');
  const aw = await db('admin_wallet_transactions').where('id', '>', marks.aw).where({ admin_id: admin.id }).orderBy('id', 'desc').first();
  assert.equal(aw.txn_type, 'credit');
});

test('refused moves change nothing: too much, user too poor, bad decimals, not a managed user', async () => {
  const a0 = await wallet(admin.id); const u0 = await wallet(userId);
  const tooMuch = await api(BASE, adminToken).post(`/api/users/${userId}/fund`, { amount: a0 + 1, type: 'credit' });
  assert.equal(tooMuch.s, 400); assert.equal(tooMuch.b.code, 'TRANSFER_FAILED');
  const tooPoor = await api(BASE, adminToken).post(`/api/users/${userId}/fund`, { amount: u0 + 1, type: 'debit' });
  assert.equal(tooPoor.s, 400); assert.equal(tooPoor.b.code, 'TRANSFER_FAILED');
  assert.equal((await api(BASE, adminToken).post(`/api/users/${userId}/fund`, { amount: 1.005, type: 'credit' })).b.code, 'INVALID_AMOUNT');
  assert.equal((await api(BASE, adminToken).post(`/api/users/${userId}/fund`, { amount: 0, type: 'credit' })).b.code, 'INVALID_AMOUNT');
  // The admin account itself is not a managed user: paying yourself would lose the amount.
  assert.equal((await api(BASE, adminToken).post(`/api/users/${admin.id}/fund`, { amount: 5, type: 'credit' })).s, 404);
  assert.equal((await api(BASE, adminToken).post('/api/fund-transfers', { userId: admin.id, amount: 5, txnType: 'credit', transactionPassword: 'x' })).s >= 400, true);
  assert.equal(await wallet(admin.id), a0); assert.equal(await wallet(userId), u0);
});

test('the Fund Transfer screen rejects a self transfer and 3-decimal amounts', async () => {
  const fundRepo = require('../src/repositories/fundTransfer.repo');
  const self = await fundRepo.transfer({ fromUserId: admin.id, toUserId: admin.id, amount: 5, transferType: 'credit' });
  assert.equal(self.ok, false);
  const bad = await api(BASE, adminToken).post('/api/fund-transfers', { userId, amount: 1.234, txnType: 'credit', transactionPassword: 'x' });
  assert.equal(bad.b.code, 'INVALID_AMOUNT');
});

test('Admin Wallet top-up is in Account History too, so the balances chain', async () => {
  const before = await wallet(admin.id);
  const r = await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: 7.25, txnType: 'credit', remark: 'fundflow test' });
  assert.equal(r.s, 201, JSON.stringify(r.b));
  const row = await db('account_transactions').where({ user_id: admin.id, service_name: 'Admin Wallet' }).orderBy('id', 'desc').first();
  assert.equal(Number(row.before_balance), before); assert.equal(Number(row.updated_balance), before + 7.25);
  assert.equal((await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: 1.999, txnType: 'credit', remark: 'x' })).b.code, 'INVALID_AMOUNT');
});
