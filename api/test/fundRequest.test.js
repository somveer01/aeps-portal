'use strict';

// Fund requests: every managed user picks a company bank and the ADMIN approves all of them (2026-10-15 rule). Since 2026-10-27 an approval is paid
// out of the ADMIN WALLET (the treasury): debit the admin, credit the requester, refused when the admin wallet cannot cover it.
// Throwaway user types, users and company bank, removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');
const wallet = require('../src/services/wallet.service');
const { round2 } = require('../src/utils/money');

const PORT = 3899;
const BASE = `http://localhost:${PORT}`;
const TAG = `fr${Date.now()}`;
const PIN = 'Test@1234';
let server; let admin; let bankId; let offBankId; let adminStart;
const types = {}; const users = {};
const tok = async (key) => signFor(key === 'ADMIN' ? await adminUser() : await db('users').where({ id: users[key].id }).first());
const adminBal = async () => Number((await db('users').where({ id: admin.id }).first('wallet_balance')).wallet_balance);
const bal = async (key) => Number((await db('users').where({ id: users[key].id }).first('wallet_balance')).wallet_balance);
const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const req = (extra = {}) => ({ amount: 200, paymentMode: 'UPI', depositDate: today(), utr: `${TAG}${(seq += 1)}`.toUpperCase().replace(/[^A-Z0-9]/g, ''), companyBankId: bankId, ...extra });
const idOf = (row) => (typeof row === 'object' ? row.id : row);

async function mkType(key, parentKey) {
  const [row] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = idOf(row);
}
async function mkUser(key, typeKey, wallet, creatorId) {
  const [row] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash(PIN, 4), mobile: '9000000000',
    full_name: `FR ${key}`, role: 'user', user_type_id: types[typeKey], parent_id: creatorId === admin.id ? null : creatorId,
    created_by: creatorId, wallet_balance: wallet,
  }).returning('id');
  users[key] = { id: idOf(row) };
}

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  adminStart = Number(admin.wallet_balance);
  await db.transaction((trx) => wallet.credit(trx, { userId: admin.id, amount: 1000, service: 'Admin Wallet', remark: `${TAG} topup` }));
  const bank = (b) => ({ bank_name: `${TAG} Bank ${b}`, account_holder: 'Test Company', account_no: `00000000${b}`, ifsc_code: 'TEST0000001' });
  bankId = idOf((await db('company_banks').insert({ ...bank(1), is_active: true }).returning('id'))[0]);
  offBankId = idOf((await db('company_banks').insert({ ...bank(2), is_active: false }).returning('id'))[0]);
  await mkType('MD'); await mkType('DIST', 'MD'); await mkType('RET', 'DIST');
  await mkUser('MD', 'MD', 1000, admin.id);
  await mkUser('D', 'DIST', 500, users.MD.id);
  await mkUser('R', 'RET', 0, users.D.id);
});

after(async () => {
  const ids = Object.values(users).map((u) => u.id);
  // The admin wallet goes back to what it was (through the wallet service), then the admin rows this file wrote are removed: the last
  // row left is the one from before this file, so the admin's ledger still matches its balance.
  const diff = round2((await adminBal()) - adminStart);
  if (diff !== 0) await db.transaction((trx) => wallet.apply(trx, { userId: admin.id, type: diff > 0 ? 'debit' : 'credit', amount: Math.abs(diff), service: 'Admin Wallet', remark: `${TAG} restore` }));
  const remarks = (await db('fund_requests').whereIn('user_id', ids).pluck('request_id')).map((r) => `Fund request ${r} approved`);
  await db('account_transactions').where({ user_id: admin.id }).where((w) => w.where('remark', 'like', `${TAG}%`).orWhereIn('remark', remarks)).del();
  await db('admin_wallet_transactions').where({ admin_id: admin.id }).whereIn('remark', remarks).del();
  await db('fund_requests').whereIn('user_id', ids).del();
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('audit_log').whereIn('user_id', ids).del();
  await db('idempotency_keys').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).update({ parent_id: null, created_by: null });
  await db('users').whereIn('id', ids).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  await db('company_banks').whereIn('id', [bankId, offBankId]).del();
  server.close();
  await db.destroy();
});

test('a retailer made by a distributor still sends the request to the admin and picks a company bank; validation', async () => {
  const r = await tok('R');
  const meta = await api(BASE, r).get('/api/my/fund-request/meta');
  assert.equal(meta.b.approver.isAdmin, true, 'the admin approves, not the distributor who created the retailer');
  assert.ok(meta.b.banks.some((b) => b.id === bankId), 'active company banks are offered');
  assert.ok(!meta.b.banks.some((b) => b.id === offBankId), 'a switched-off bank is not offered');

  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ companyBankId: null }))).b.code, 'INVALID_BANK', 'a company bank is required');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ companyBankId: offBankId }))).b.code, 'INVALID_BANK', 'not a switched-off bank');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ utr: '' }))).b.code, 'INVALID_UTR');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ depositDate: '2999-01-01' }))).b.code, 'INVALID_DATE');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ paymentMode: 'Bitcoin' }))).b.code, 'INVALID_MODE');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ paymentMode: 'Cash', utr: '' }))).s, 201, 'cash needs no UTR');

  const ok = await api(BASE, r).post('/api/my/fund-requests', req({ utr: 'UTRDUP123456' }));
  assert.equal(ok.s, 201);
  assert.equal(ok.b.row.approver_id, admin.id);
  assert.equal(ok.b.row.approver_role, 'admin');
  assert.equal(ok.b.row.company_bank_id, bankId);
  assert.equal(ok.b.row.status, 'pending');
  users.R.req = ok.b.row.id;
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ utr: 'utrdup123456' }))).b.code, 'DUPLICATE_UTR');
  assert.equal((await api(BASE, r).get('/api/my/fund-requests')).b.total, 2);
});

test('only the admin acts: the distributor who created the retailer cannot; approval is paid out of the Admin wallet', async () => {
  const dList = await api(BASE, await tok('D')).get('/api/network/fund-requests?status=pending');
  assert.ok(!(dList.b.rows || []).some((x) => x.id === users.R.req), 'the distributor no longer sees it to approve');
  assert.equal((await api(BASE, await tok('D')).put(`/api/network/fund-requests/${users.R.req}`, { status: 'approved', transactionPassword: PIN })).b.code, 'NOT_APPROVER');

  const adminBefore = await adminBal();
  const dBefore = await bal('D');
  const ok = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${users.R.req}`, { status: 'approved', adminRemark: 'Seen in bank' });
  assert.equal(ok.s, 200);
  assert.equal(ok.b.row.status, 'approved');
  assert.equal(ok.b.row.acted_by, admin.id);
  assert.equal(await bal('R'), 200);
  assert.equal(await bal('D'), dBefore, 'the distributor\'s wallet is not touched');
  assert.equal(await adminBal(), adminBefore - 200, 'the amount comes out of the Admin wallet: no wallet money is created');
  // both sides are in the ledger and the Admin Wallet screen history shows the debit
  const led = await db('account_transactions').where({ user_id: admin.id, service_name: 'Fund Request', type: 'debit' }).orderBy('id', 'desc').first();
  assert.equal(Number(led.amount), 200); assert.equal(Number(led.before_balance), adminBefore); assert.equal(Number(led.updated_balance), adminBefore - 200);
  const hist = await db('admin_wallet_transactions').where({ admin_id: admin.id, txn_type: 'debit' }).orderBy('id', 'desc').first();
  assert.match(hist.remark, /^Fund request .* approved$/); assert.equal(Number(hist.amount), 200); assert.equal(Number(hist.updated_balance), adminBefore - 200);
  const credit = await db('account_transactions').where({ user_id: users.R.id, service_name: 'Fund Request', type: 'credit' }).first();
  assert.equal(Number(credit.amount), 200);
  assert.equal((await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${users.R.req}`, { status: 'approved' })).b.code, 'ALREADY_PROCESSED');
});

test('an approval the Admin wallet cannot cover is refused (INSUFFICIENT_BALANCE): nothing moves and the request stays pending; a rejection moves nothing', async () => {
  const have = await adminBal();
  const amount = Math.ceil(have) + 500;
  const made = await api(BASE, await tok('R')).post('/api/my/fund-requests', req({ amount, utr: 'UTRNOCOVER01' }));
  assert.equal(made.s, 201, JSON.stringify(made.b));
  const rBefore = await bal('R');
  const refused = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${made.b.row.id}`, { status: 'approved' });
  assert.equal(refused.s, 400); assert.equal(refused.b.code, 'INSUFFICIENT_BALANCE');
  assert.match(refused.b.error, /Admin wallet/); assert.match(refused.b.error, /Add Fund/);
  assert.equal(await adminBal(), have, 'the Admin wallet is untouched'); assert.equal(await bal('R'), rBefore, 'nothing credited');
  assert.equal((await db('fund_requests').where({ id: made.b.row.id }).first('status')).status, 'pending');
  const rej = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${made.b.row.id}`, { status: 'rejected', adminRemark: 'no cover' });
  assert.equal(rej.s, 200); assert.equal(await adminBal(), have); assert.equal(await bal('R'), rBefore);
});

test('after topping the Admin wallet up, the same kind of approval goes through; the admin balance + the requester balance stay equal to before (moved, not created)', async () => {
  const made = await api(BASE, await tok('R')).post('/api/my/fund-requests', req({ amount: 300, utr: 'UTRMOVE00001' }));
  const sumBefore = round2((await adminBal()) + (await bal('R')));
  const ok = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${made.b.row.id}`, { status: 'approved' });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
  assert.equal(round2((await adminBal()) + (await bal('R'))), sumBefore, 'what leaves the Admin wallet arrives in the requester\'s wallet');
});

test('distributors and super distributors also go to the admin; a rejected UTR can be reused', async () => {
  for (const key of ['D', 'MD']) {
    // eslint-disable-next-line no-await-in-loop
    const created = await api(BASE, await tok(key)).post('/api/my/fund-requests', req({ amount: 100 }));
    assert.equal(created.s, 201, key);
    assert.equal(created.b.row.approver_id, admin.id, `${key}: approver is the admin`);
  }
  const r = await tok('R');
  const big = await api(BASE, r).post('/api/my/fund-requests', req({ amount: 5000, utr: 'UTRBIG000001' }));
  const rej = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${big.b.row.id}`, { status: 'rejected', adminRemark: 'Payment not found' });
  assert.equal(rej.b.row.status, 'rejected');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ utr: 'UTRBIG000001' }))).s, 201, 'UTR free again after rejection');
});

test('an old pending request that still names a distributor is handed to the admin by the migration rule', async () => {
  const [row] = await db('fund_requests').insert({
    user_id: users.R.id, approver_id: users.D.id, company_bank_id: null, deposit_date: today(), payment_mode: 'Cash', amount: 50,
    request_id: `${TAG}OLD`, status: 'pending',
  }).returning('id');
  const id = idOf(row);
  // same statement as migrations/20261015110000_fund_requests_admin_only.js
  await db('fund_requests').where({ status: 'pending' }).whereIn('approver_id', db('users').whereNot({ role: 'admin' }).select('id'))
    .where({ id }).update({ approver_id: admin.id });
  const ok = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${id}`, { status: 'approved' });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
});
