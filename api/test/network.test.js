'use strict';

// Distributor / MD panel over HTTP, on throwaway user types + users (removed afterwards).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor } = require('./helper');

const PORT = 3898;
const BASE = `http://localhost:${PORT}`;
const TAG = `net${Date.now()}`;
const PIN = 'Test@1234';
let server;
const types = {}; const users = {};
const tok = async (key) => signFor(await db('users').where({ id: users[key].id }).first());
const bal = async (key) => Number((await db('users').where({ id: users[key].id }).first('wallet_balance')).wallet_balance);

async function mkType(key, parentKey) {
  const [row] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = typeof row === 'object' ? row.id : row;
}
async function mkUser(key, typeKey, wallet = 0, parentId = null) {
  const [row] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash(PIN, 4), mobile: '9000000000',
    full_name: `Net ${key}`, role: 'user', user_type_id: types[typeKey], parent_id: parentId, wallet_balance: wallet,
  }).returning('id');
  users[key] = { id: typeof row === 'object' ? row.id : row };
}

before(async () => {
  server = await startServer(PORT);
  await mkType('MD'); await mkType('DIST', 'MD'); await mkType('RET', 'DIST');
  await mkUser('MD', 'MD', 1000);
  await mkUser('OTHER', 'DIST', 0); // a distributor outside MD's network
});

after(async () => {
  const ids = Object.values(users).map((u) => u.id);
  await db('audit_log').whereIn('user_id', ids).del();
  await db('fund_transfers').whereIn('from_user_id', ids).del();
  await db('service_transactions').whereIn('user_id', ids).del();
  await db('idempotency_keys').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).update({ parent_id: null, created_by: null });
  await db('users').whereIn('id', ids).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  server.close();
  await db.destroy();
});

const newUser = (typeKey, extra = {}) => ({ name: 'Downline User', mobile: '9000000001', password: PIN, userTypeId: types[typeKey], ...extra });

test('MD sees My Network menu and can only create the type directly below it', async () => {
  const t = await tok('MD');
  const menu = await api(BASE, t).get('/api/menu');
  assert.ok(JSON.stringify(menu.b).includes('/network/users'), 'network menu shown');
  const meta = await api(BASE, t).get('/api/network/meta');
  assert.deepEqual(meta.b.childTypes.map((c) => c.id), [types.DIST]);

  const bad = await api(BASE, t).post('/api/network/users', newUser('RET'));
  assert.equal(bad.s, 400);
  assert.equal(bad.b.code, 'INVALID_USER_TYPE');

  const ok = await api(BASE, t).post('/api/network/users', newUser('DIST', { parentId: users.OTHER.id, createdBy: 1 }));
  assert.equal(ok.s, 201);
  users.D = { id: ok.b.row.id };
  const row = await db('users').where({ id: users.D.id }).first();
  assert.equal(row.parent_id, users.MD.id, 'parent is always the caller');
  assert.equal(row.created_by, users.MD.id);
  assert.ok(row.user_code, 'user code generated');
});

test('distributor creates a retailer; MD sees both, the distributor sees only theirs', async () => {
  const r = await api(BASE, await tok('D')).post('/api/network/users', newUser('RET', { kycStatus: 'verified', serviceAccess: [1] }));
  assert.equal(r.s, 201);
  users.R = { id: r.b.row.id };
  const row = await db('users').where({ id: users.R.id }).first();
  assert.equal(row.kyc_status, 'pending', 'admin-only fields are ignored');

  const mdList = (await api(BASE, await tok('MD')).get('/api/network/users')).b.rows.map((x) => x.id).sort();
  assert.deepEqual(mdList, [users.D.id, users.R.id].sort());
  const dList = (await api(BASE, await tok('D')).get('/api/network/users')).b.rows.map((x) => x.id);
  assert.deepEqual(dList, [users.R.id]);
  const filtered = await api(BASE, await tok('MD')).get(`/api/network/users?userTypeId=${types.RET}`);
  assert.deepEqual(filtered.b.rows.map((x) => x.id), [users.R.id]);
});

test('a retailer has no network panel but can read states', async () => {
  const t = await tok('R');
  assert.equal((await api(BASE, t).get('/api/network/users')).s, 403);
  const menu = await api(BASE, t).get('/api/menu');
  assert.ok(!JSON.stringify(menu.b).includes('/network/users'));
  assert.equal((await api(BASE, t).get('/api/states')).s, 200);
});

test('edit: anyone in the downline; plan only for direct users; outsiders get 404', async () => {
  const md = await tok('MD');
  const e = await api(BASE, md).put(`/api/network/users/${users.R.id}`, { name: 'Renamed Retailer', kycStatus: 'verified' });
  assert.equal(e.s, 200);
  assert.equal(e.b.row.name, 'Renamed Retailer');
  assert.equal(e.b.row.kyc_status, 'pending');
  const [plan] = await db('plans').insert({ user_type_id: types.RET, name: `${TAG} plan` }).returning('id');
  const planId = typeof plan === 'object' ? plan.id : plan;
  try {
    assert.equal((await api(BASE, md).put(`/api/network/users/${users.R.id}`, { planId })).b.code, 'NOT_DIRECT_DOWNLINE');
    const ok = await api(BASE, await tok('D')).put(`/api/network/users/${users.R.id}`, { planId });
    assert.equal(ok.s, 200);
    assert.equal(ok.b.row.plan_id, planId);
  } finally {
    await db('users').where({ id: users.R.id }).update({ plan_id: null });
    await db('plans').where({ id: planId }).del();
  }
  assert.equal((await api(BASE, await tok('OTHER')).put(`/api/network/users/${users.R.id}`, { name: 'x' })).s, 404);
});

test('lookup finds only direct users', async () => {
  const code = (await db('users').where({ id: users.R.id }).first('user_code')).user_code;
  assert.equal((await api(BASE, await tok('D')).get(`/api/network/lookup?code=${code}`)).b.user.id, users.R.id);
  assert.equal((await api(BASE, await tok('MD')).get(`/api/network/lookup?code=${code}`)).s, 404);
});

test('fund transfer: zero-sum to a direct user only, with PIN', async () => {
  const md = await tok('MD');
  const credit = await api(BASE, md).post('/api/network/fund-transfer', { userId: users.D.id, amount: 300, txnType: 'credit', transactionPassword: PIN });
  assert.equal(credit.s, 201);
  assert.equal(Number(credit.b.row.updated_balance), 300);
  assert.equal(await bal('MD'), 700);
  assert.equal(await bal('D'), 300);

  const d = await tok('D');
  assert.equal((await api(BASE, d).post('/api/network/fund-transfer', { userId: users.R.id, amount: 100, txnType: 'credit', transactionPassword: 'wrong' })).s, 401);
  assert.equal((await api(BASE, d).post('/api/network/fund-transfer', { userId: users.R.id, amount: 100.5, txnType: 'credit', transactionPassword: PIN })).s, 201);
  assert.equal(await bal('D'), 199.5);
  assert.equal(await bal('R'), 100.5);
  assert.equal((await api(BASE, d).post('/api/network/fund-transfer', { userId: users.R.id, amount: 0.5, txnType: 'debit', transactionPassword: PIN })).s, 201);
  assert.equal(await bal('R'), 100);
  assert.equal((await api(BASE, d).post('/api/network/fund-transfer', { userId: users.R.id, amount: 5000, txnType: 'credit', transactionPassword: PIN })).s, 400);

  assert.equal((await api(BASE, md).post('/api/network/fund-transfer', { userId: users.R.id, amount: 1, txnType: 'credit', transactionPassword: PIN })).b.code, 'NOT_DIRECT_DOWNLINE');
  assert.equal((await api(BASE, md).post('/api/network/fund-transfer', { userId: users.OTHER.id, amount: 1, txnType: 'credit', transactionPassword: PIN })).b.code, 'NOT_DIRECT_DOWNLINE');

  const hist = await api(BASE, d).get('/api/network/fund-transfers');
  assert.equal(hist.b.total, 2);
  assert.ok(hist.b.rows.every((x) => x.from_user_id === users.D.id));
});

test('downline report: MD sees the retailer\'s transactions, an outsider does not', async () => {
  await db('service_transactions').insert({ user_id: users.R.id, service: 'Mobile Recharge', amount: 50, status: 'success' });
  const code = (await db('users').where({ id: users.R.id }).first('user_code')).user_code;
  const rep = await api(BASE, await tok('MD')).get('/api/network/report');
  assert.equal(rep.s, 200);
  assert.equal(rep.b.total, 1);
  assert.equal(rep.b.rows[0].user_code, code);
  assert.equal((await api(BASE, await tok('OTHER')).get('/api/network/report')).b.total, 0);
  assert.equal((await api(BASE, await tok('OTHER')).get(`/api/network/report?userId=${users.R.id}`)).b.total, 0);
});

test('MD blocks a user two levels down; the user is signed out and cannot receive funds', async () => {
  const rToken = await tok('R');
  const res = await api(BASE, await tok('MD')).put(`/api/network/users/${users.R.id}`, { isActive: false });
  assert.equal(res.s, 200);
  assert.equal((await api(BASE, rToken).get('/api/retailer/summary')).s, 401);
  const t = await api(BASE, await tok('D')).post('/api/network/fund-transfer', { userId: users.R.id, amount: 1, txnType: 'credit', transactionPassword: PIN });
  assert.equal(t.b.code, 'USER_BLOCKED');
});
