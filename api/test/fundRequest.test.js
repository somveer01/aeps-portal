'use strict';

// Fund requests approved by whoever created the requester, on throwaway users/types.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');

const PORT = 3899;
const BASE = `http://localhost:${PORT}`;
const TAG = `fr${Date.now()}`;
const PIN = 'Test@1234';
let server; let admin; let bank;
const types = {}; const users = {};
const tok = async (key) => signFor(key === 'ADMIN' ? await adminUser() : await db('users').where({ id: users[key].id }).first());
const bal = async (key) => Number((await db('users').where({ id: users[key].id }).first('wallet_balance')).wallet_balance);
const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const req = (extra = {}) => ({ amount: 200, paymentMode: 'UPI', depositDate: today(), utr: `${TAG}${(seq += 1)}`.toUpperCase().replace(/[^A-Z0-9]/g, ''), ...extra });

async function mkType(key, parentKey) {
  const [row] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = typeof row === 'object' ? row.id : row;
}
async function mkUser(key, typeKey, wallet, creatorId) {
  const [row] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash(PIN, 4), mobile: '9000000000',
    full_name: `FR ${key}`, role: 'user', user_type_id: types[typeKey], parent_id: creatorId === admin.id ? null : creatorId,
    created_by: creatorId, wallet_balance: wallet,
  }).returning('id');
  users[key] = { id: typeof row === 'object' ? row.id : row };
}

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  bank = await db('company_banks').where({ is_active: true }).first('id');
  await mkType('MD'); await mkType('DIST', 'MD'); await mkType('RET', 'DIST');
  await mkUser('MD', 'MD', 1000, admin.id);
  await mkUser('D', 'DIST', 500, users.MD.id);
  await mkUser('R', 'RET', 0, users.D.id);
});

after(async () => {
  const ids = Object.values(users).map((u) => u.id);
  await db('fund_requests').whereIn('user_id', ids).del();
  await db('audit_log').whereIn('user_id', ids).del();
  await db('idempotency_keys').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).update({ parent_id: null, created_by: null });
  await db('users').whereIn('id', ids).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  server.close();
  await db.destroy();
});

test('a retailer\'s approver is the distributor who created them; validation', async () => {
  const r = await tok('R');
  const meta = await api(BASE, r).get('/api/my/fund-request/meta');
  assert.equal(meta.b.approver.code, `${TAG}D`);
  assert.equal(meta.b.approver.isAdmin, false);
  assert.deepEqual(meta.b.banks, []);

  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ utr: '' }))).b.code, 'INVALID_UTR');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ depositDate: '2999-01-01' }))).b.code, 'INVALID_DATE');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ paymentMode: 'Bitcoin' }))).b.code, 'INVALID_MODE');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ paymentMode: 'Cash', utr: '' }))).s, 201, 'cash needs no UTR');

  const ok = await api(BASE, r).post('/api/my/fund-requests', req({ utr: 'UTRDUP123456' }));
  assert.equal(ok.s, 201);
  assert.equal(ok.b.row.approver_id, users.D.id);
  assert.equal(ok.b.row.status, 'pending');
  users.R.req = ok.b.row.id;
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ utr: 'utrdup123456' }))).b.code, 'DUPLICATE_UTR');

  const mine = await api(BASE, r).get('/api/my/fund-requests');
  assert.equal(mine.b.total, 2);
});

test('only the approver sees and acts; approval is zero-sum and needs the PIN', async () => {
  const dList = await api(BASE, await tok('D')).get('/api/network/fund-requests?status=pending');
  assert.ok(dList.b.rows.some((x) => x.id === users.R.req));
  const mdList = await api(BASE, await tok('MD')).get('/api/network/fund-requests');
  assert.ok(!mdList.b.rows.some((x) => x.id === users.R.req), 'MD does not approve a retailer made by D');

  assert.equal((await api(BASE, await tok('MD')).put(`/api/network/fund-requests/${users.R.req}`, { status: 'approved', transactionPassword: PIN })).b.code, 'NOT_APPROVER');
  assert.equal((await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${users.R.req}`, { status: 'approved' })).b.code, 'NOT_APPROVER');

  const d = await tok('D');
  assert.equal((await api(BASE, d).put(`/api/network/fund-requests/${users.R.req}`, { status: 'approved', transactionPassword: 'wrong' })).s, 401);
  const ok = await api(BASE, d).put(`/api/network/fund-requests/${users.R.req}`, { status: 'approved', transactionPassword: PIN, adminRemark: 'Cash received' });
  assert.equal(ok.s, 200);
  assert.equal(ok.b.row.status, 'approved');
  assert.equal(ok.b.row.acted_by, users.D.id);
  assert.equal(await bal('D'), 300);
  assert.equal(await bal('R'), 200);
  assert.equal((await api(BASE, d).put(`/api/network/fund-requests/${users.R.req}`, { status: 'approved', transactionPassword: PIN })).b.code, 'ALREADY_PROCESSED');
});

test('not enough balance keeps the request pending; a rejected UTR can be reused', async () => {
  const r = await tok('R'); const d = await tok('D');
  const big = await api(BASE, r).post('/api/my/fund-requests', req({ amount: 5000, utr: 'UTRBIG000001' }));
  assert.equal((await api(BASE, d).put(`/api/network/fund-requests/${big.b.row.id}`, { status: 'approved', transactionPassword: PIN })).b.code, 'INSUFFICIENT_BALANCE');
  assert.equal((await db('fund_requests').where({ id: big.b.row.id }).first('status')).status, 'pending');
  assert.equal(await bal('D'), 300);

  const rej = await api(BASE, d).put(`/api/network/fund-requests/${big.b.row.id}`, { status: 'rejected', adminRemark: 'Payment not found' });
  assert.equal(rej.b.row.status, 'rejected');
  assert.equal((await api(BASE, r).post('/api/my/fund-requests', req({ utr: 'UTRBIG000001' }))).s, 201, 'UTR free again after rejection');
});

test('same for a distributor: the MD who created them approves', async () => {
  const dReq = await api(BASE, await tok('D')).post('/api/my/fund-requests', req({ amount: 100 }));
  assert.equal(dReq.b.row.approver_id, users.MD.id);
  const ok = await api(BASE, await tok('MD')).put(`/api/network/fund-requests/${dReq.b.row.id}`, { status: 'approved', transactionPassword: PIN });
  assert.equal(ok.s, 200);
  assert.equal(await bal('MD'), 900);
  assert.equal(await bal('D'), 400);
});

test('an MD created by the admin deposits into a company bank; the admin approves', async () => {
  const md = await tok('MD');
  const meta = await api(BASE, md).get('/api/my/fund-request/meta');
  assert.equal(meta.b.approver.isAdmin, true);
  assert.equal((await api(BASE, md).post('/api/my/fund-requests', req())).b.code, 'INVALID_BANK');
  if (!bank) return; // no active company bank on this database
  const created = await api(BASE, md).post('/api/my/fund-requests', req({ amount: 250, companyBankId: bank.id }));
  assert.equal(created.s, 201);
  const adminBefore = Number((await adminUser()).wallet_balance);
  const ok = await api(BASE, await tok('ADMIN')).put(`/api/fund-requests/${created.b.row.id}`, { status: 'approved' });
  assert.equal(ok.s, 200);
  assert.equal(ok.b.row.approver_role, 'admin');
  assert.equal(await bal('MD'), 1150);
  assert.equal(Number((await adminUser()).wallet_balance), adminBefore, 'deposit into company bank is new money');
});
