'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, anyManagedUser, signFor } = require('./helper');

const PORT = 3897;
const BASE = `http://localhost:${PORT}`;

let server;
let admin;
let adminToken;
let managedToken;
let origAdmin; // snapshot to restore

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  origAdmin = await db('users').where({ id: admin.id }).first('password_hash', 'wallet_balance', 'token_epoch', 'txn_pin_hash');
  adminToken = signFor(admin);
  const mu = await anyManagedUser();
  if (mu) managedToken = signFor(mu);
});

after(async () => {
  // Restore admin password, wallet, epoch, pin; clear test artifacts.
  await db('users').where({ id: admin.id }).update({
    password_hash: origAdmin.password_hash,
    wallet_balance: origAdmin.wallet_balance,
    token_epoch: origAdmin.token_epoch,
    txn_pin_hash: origAdmin.txn_pin_hash || null,
  });
  await db('admin_wallet_transactions').where({ admin_id: admin.id }).del();
  await db('idempotency_keys').where({ user_id: admin.id }).del();
  server.close();
  await db.destroy();
});

test('health reports mode + adapters + version', async () => {
  const { s, b } = await api(BASE).get('/api/health');
  assert.equal(s, 200);
  assert.ok(b.mode, 'mode present');
  assert.ok(b.version, 'version present');
  assert.ok(b.adapters && b.adapters.kyc, 'adapters present');
});

test('RBAC: no token -> 401, admin -> 200, managed user -> 403', async () => {
  const anon = await api(BASE).get('/api/users?pageSize=1');
  assert.equal(anon.s, 401);
  const asAdmin = await api(BASE, adminToken).get('/api/users?pageSize=1');
  assert.equal(asAdmin.s, 200);
  if (managedToken) {
    const asUser = await api(BASE, managedToken).get('/api/users?pageSize=1');
    assert.equal(asUser.s, 403, JSON.stringify(asUser.b));
  }
});

test('validation: bad admin-wallet amount -> 400 with code', async () => {
  const r = await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: 0, txnType: 'credit', remark: 'x' });
  assert.equal(r.s, 400);
  assert.ok(r.b.code, 'error code present');
});

test('idempotency: repeated key does not double-credit the wallet', async () => {
  const before = (await api(BASE, adminToken).get('/api/admin-wallet/balance')).b.balance;
  const key = `test-${Date.now()}`;
  const r1 = await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: 250, txnType: 'credit', remark: 'idem' }, { 'Idempotency-Key': key });
  const r2 = await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: 250, txnType: 'credit', remark: 'idem' }, { 'Idempotency-Key': key });
  assert.equal(r1.s, 201);
  assert.equal(r2.s, 201);
  assert.equal(r2.h.get('idempotent-replay'), 'true', 'second call is a replay');
  const after = (await api(BASE, adminToken).get('/api/admin-wallet/balance')).b.balance;
  assert.ok(Math.abs((after - before) - 250) < 0.001, `wallet moved once (before ${before}, after ${after})`);
});

test('admin wallet: credit then debit, overdraw guarded', async () => {
  const start = (await api(BASE, adminToken).get('/api/admin-wallet/balance')).b.balance;
  const c = await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: 100, txnType: 'credit', remark: 'c' });
  assert.equal(c.s, 201);
  const over = await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: start + 1e6, txnType: 'debit', remark: 'x' });
  assert.equal(over.s, 400);
});

test('change password revokes existing tokens', async () => {
  // Use a throwaway epoch bump: change to a temp password, old token must break.
  const r = await api(BASE, adminToken).post('/api/account/change-password', {
    currentPassword: origAdminPassword(), newPassword: 'Temp@98765', confirmPassword: 'Temp@98765',
  });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(r.b.reauth, true);
  // Old token now revoked.
  const stale = await api(BASE, adminToken).get('/api/users?pageSize=1');
  assert.equal(stale.s, 401);
  assert.equal(stale.b.code, 'TOKEN_REVOKED');
  // Fresh token with new epoch works; change password back.
  const fresh = signFor(await db('users').where({ id: admin.id }).first());
  const back = await api(BASE, fresh).post('/api/account/change-password', {
    currentPassword: 'Temp@98765', newPassword: origAdminPassword(), confirmPassword: origAdminPassword(),
  });
  assert.equal(back.s, 200);
});

test('transaction PIN: set + used for fund transfer authorization', async () => {
  // Set a PIN
  const t1 = signFor(await db('users').where({ id: admin.id }).first());
  const set = await api(BASE, t1).post('/api/account/txn-pin', { currentPassword: origAdminPassword(), pin: '4321', confirmPin: '4321' });
  assert.equal(set.s, 200, JSON.stringify(set.b));
  // Wrong PIN on transfer -> 401 (need a receiver)
  const mu = await anyManagedUser();
  if (mu) {
    const t2 = signFor(await db('users').where({ id: admin.id }).first());
    const bad = await api(BASE, t2).post('/api/fund-transfers', { userId: mu.id, amount: 1, txnType: 'credit', remark: 'pin test', transactionPassword: '0000' });
    assert.equal(bad.s, 401);
    const t3 = signFor(await db('users').where({ id: admin.id }).first());
    const good = await api(BASE, t3).post('/api/fund-transfers', { userId: mu.id, amount: 1, txnType: 'credit', remark: 'pin test', transactionPassword: '4321' });
    assert.equal(good.s, 201, JSON.stringify(good.b));
    // undo the +1 credit
    const t4 = signFor(await db('users').where({ id: admin.id }).first());
    await api(BASE, t4).post('/api/fund-transfers', { userId: mu.id, amount: 1, txnType: 'debit', remark: 'pin test undo', transactionPassword: '4321' });
  }
});

test('audit log written for wallet adjust', async () => {
  await api(BASE, adminToken).post('/api/admin-wallet/add', { amount: 5, txnType: 'credit', remark: 'audit check' }).catch(() => {});
  const row = await db('audit_log').where({ event: 'admin_wallet_adjust' }).orderBy('id', 'desc').first();
  assert.ok(row, 'admin_wallet_adjust audit row exists');
});

test('user creation records creator; parent validated (self, cycle)', async () => {
  const ut = await db('user_types').orderBy('id').first('id');
  const tok = signFor(await adminUser()); // earlier tests bump token_epoch, so mint a fresh token
  const mk = (name, extra) => api(BASE, tok).post('/api/users', { name, mobile: '9000000099', userTypeId: ut.id, password: 'Test@1234', ...extra });
  const created = [];
  try {
    // createdBy in the body must be ignored: the creator is always the caller.
    const a = await mk('Chain Test A', { createdBy: 999999 });
    assert.equal(a.s, 201);
    created.push(a.b.row.id);
    assert.equal(a.b.row.created_by, admin.id);
    assert.ok(a.b.row.created_by_name, 'creator name joined');
    assert.ok(await db('audit_log').where({ event: 'user_created', user_id: admin.id }).whereRaw("detail->>'newUserId' = ?", [String(a.b.row.id)]).first(), 'audit row written');

    const b = await mk('Chain Test B', { parentId: a.b.row.id });
    assert.equal(b.s, 201);
    created.push(b.b.row.id);
    assert.equal(b.b.row.parent_id, a.b.row.id);

    assert.equal((await mk('Bad Parent', { parentId: 999999 })).s, 400);
    const self = await api(BASE, tok).put(`/api/users/${a.b.row.id}`, { parentId: a.b.row.id });
    assert.equal(self.s, 400);
    const cycle = await api(BASE, tok).put(`/api/users/${a.b.row.id}`, { parentId: b.b.row.id }); // B is A's child
    assert.equal(cycle.s, 400);
    assert.equal(cycle.b.code, 'PARENT_CYCLE');
  } finally {
    await db('audit_log').where({ event: 'user_created' }).whereRaw("detail->>'newUserId' = ANY(?)", [created.map(String)]).del();
    if (created.length) await db('users').whereIn('id', created).del();
  }
});

// The seed password (kept out of the token so tests read it from env/default).
function origAdminPassword() { return process.env.SEED_ADMIN_PASSWORD || 'Admin@12345'; }
