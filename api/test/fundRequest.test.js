'use strict';

// Fund requests: every managed user picks a company bank and the ADMIN approves all of them (2026-10-15 rule).
// Throwaway user types, users and company bank, removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');

const PORT = 3899;
const BASE = `http://localhost:${PORT}`;
const TAG = `fr${Date.now()}`;
const PIN = 'Test@1234';
let server; let admin; let bankId; let offBankId;
const types = {}; const users = {};
const tok = async (key) => signFor(key === 'ADMIN' ? await adminUser() : await db('users').where({ id: users[key].id }).first());
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

test('only the admin acts: the distributor who created the retailer cannot; approval is new money from the company bank', async () => {
  const dList = await api(BASE, await tok('D')).get('/api/network/fund-requests?status=pending');
  assert.ok(!(dList.b.rows || []).some((x) => x.id === users.R.req), 'the distributor no longer sees it to approve');
  assert.equal((await api(BASE, await tok('D')).put(`/api/network/fund-requests/${users.R.req}`, { status: 'approved', transactionPassword: PIN })).b.code, 'NOT_APPROVER');

  const adminBefore = Number((await adminUser()).wallet_balance);
  const dBefore = await bal('D');
  const ok = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${users.R.req}`, { status: 'approved', adminRemark: 'Seen in bank' });
  assert.equal(ok.s, 200);
  assert.equal(ok.b.row.status, 'approved');
  assert.equal(ok.b.row.acted_by, admin.id);
  assert.equal(await bal('R'), 200);
  assert.equal(await bal('D'), dBefore, 'the distributor\'s wallet is not touched');
  assert.equal(Number((await adminUser()).wallet_balance), adminBefore, 'a deposit into a company bank is new money, not taken from the admin wallet');
  assert.equal((await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${users.R.req}`, { status: 'approved' })).b.code, 'ALREADY_PROCESSED');
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
