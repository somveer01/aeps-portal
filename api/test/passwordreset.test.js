'use strict';

// Admin resets a managed user's password: temporary password, everything signed out, lock cleared, the user must choose
// their own before anything else (the API enforces it), no password in the audit log. Plus the admin recovery script.
// Throwaway type and users, removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');
const { resetAdminPassword } = require('../scripts/reset-admin-password');

const PORT = 3917;
const BASE = `http://localhost:${PORT}`;
const TAG = `pr${Date.now()}`;
const OLD = 'OldPass#123';
let server; let admin; let typeId; let userId; let spareAdminId;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch
const row = () => db('users').where({ id: userId }).first();
const asUser = async () => api(BASE, signFor(await row()));

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  const [t] = await db('user_types').insert({ name: `${TAG} R` }).returning('id');
  typeId = idOf(t);
  const [u] = await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash(OLD, 4), mobile: '9000000000', full_name: 'Reset Test',
    first_name: 'Reset', last_name: 'Test', role: 'user', user_type_id: typeId, parent_id: admin.id, created_by: admin.id, wallet_balance: 0, kyc_status: 'verified',
  }).returning('id');
  userId = idOf(u);
});

after(async () => {
  await db('audit_log').whereIn('event', ['password_reset', 'admin_password_reset_script', 'password_changed']).whereRaw("(detail->>'targetUserId' = ANY(?)) OR user_id = ANY(?)", [[String(userId), String(spareAdminId)], [userId, spareAdminId].filter(Boolean)]).del();
  await db('users').whereIn('id', [userId, spareAdminId].filter(Boolean)).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('reset: temporary password works, old one and old sessions do not, lock is cleared, flag is set', async () => {
  const oldTokenApi = api(BASE, signFor(await row()));
  await db('users').where({ id: userId }).update({ failed_login_attempts: 5, locked_until: new Date(Date.now() + 600000) });
  const epoch0 = (await row()).token_epoch || 0;

  const a = await A();
  const r = await a.post(`/api/users/${userId}/reset-password`, {});
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(r.b.generated, true);
  assert.match(r.b.password, /^[A-HJ-NP-Za-km-z2-9]{10}$/, '10 characters, no look-alikes');
  assert.ok(/[A-Z]/.test(r.b.password) && /[a-z]/.test(r.b.password) && /\d/.test(r.b.password));

  const u = await row();
  assert.equal(await bcrypt.compare(r.b.password, u.password_hash), true);
  assert.equal(await bcrypt.compare(OLD, u.password_hash), false);
  assert.equal(u.must_change_password, true);
  assert.equal(u.token_epoch, epoch0 + 1);
  assert.equal(u.failed_login_attempts, 0);
  assert.equal(u.locked_until, null);

  const stale = await oldTokenApi.get('/api/me');
  assert.equal(stale.s, 401);
  assert.equal(stale.b.code, 'TOKEN_REVOKED');

  const audit = await db('audit_log').where({ event: 'password_reset' }).whereRaw("detail->>'targetUserId' = ?", [String(userId)]).first();
  assert.ok(audit, 'audit row written');
  assert.ok(!JSON.stringify(audit).includes(r.b.password), 'the password is not in the audit log');
});

test('while the reset flag is set only /me, change-password and logout work (money routes are refused)', async () => {
  const me = await asUser();
  const m = await me.get('/api/me');
  assert.equal(m.s, 200);
  assert.equal(m.b.user.mustChangePassword, true);
  for (const path of ['/api/retailer/summary', '/api/menu']) {
    // eslint-disable-next-line no-await-in-loop
    const g = await me.get(path);
    assert.equal(g.s, 403, path);
    assert.equal(g.b.code, 'PASSWORD_CHANGE_REQUIRED');
  }
  const pay = await me.post('/api/recharge/mobile', { mobile: '9000000000', amount: 10 });
  assert.equal(pay.s, 403, 'a money call is refused');
  assert.equal(pay.b.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('the user chooses a new password: flag cleared, sessions revoked, new password works', async () => {
  const a = await A();
  const temp = (await a.post(`/api/users/${userId}/reset-password`, {})).b.password;
  const me = await asUser();
  const wrong = await me.post('/api/account/change-password', { currentPassword: 'nope-nope', newPassword: 'Brand#New99', confirmPassword: 'Brand#New99' });
  assert.equal(wrong.s, 401);
  const ok = await me.post('/api/account/change-password', { currentPassword: temp, newPassword: 'Brand#New99', confirmPassword: 'Brand#New99' });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
  const u = await row();
  assert.equal(u.must_change_password, false);
  assert.equal(await bcrypt.compare('Brand#New99', u.password_hash), true);
  assert.equal((await me.get('/api/me')).s, 401, 'the session is gone, a new login is needed');
  const fresh = await asUser();
  assert.equal((await fresh.get('/api/me')).s, 200);
  assert.equal((await fresh.get('/api/menu')).s, 200, 'normal access again');
});

test('admin may type the temporary password (min 8); short, unknown, admin and non-admin are refused', async () => {
  const a = await A();
  const short = await a.post(`/api/users/${userId}/reset-password`, { newPassword: 'abc' });
  assert.equal(short.s, 400);
  assert.equal(short.b.code, 'WEAK_PASSWORD');
  const given = await a.post(`/api/users/${userId}/reset-password`, { newPassword: 'Chosen#Pass1' });
  assert.equal(given.s, 200);
  assert.equal(given.b.generated, false);
  assert.equal(await bcrypt.compare('Chosen#Pass1', (await row()).password_hash), true);

  assert.equal((await a.post('/api/users/99999999/reset-password', {})).s, 404);
  assert.equal((await a.post(`/api/users/${admin.id}/reset-password`, {})).s, 404, 'the admin account cannot be reset from the app');
  assert.equal((await a.post('/api/users/abc/reset-password', {})).s, 404);

  await db('users').where({ id: userId }).update({ must_change_password: false });
  const other = await asUser(); // a managed user is not an admin
  assert.equal((await other.post(`/api/users/${userId}/reset-password`, {})).s, 403);
});

test('admin recovery script: new random password, sessions revoked, only the named admin changes', async () => {
  const [s] = await db('users').insert({
    username: `${TAG}adm`, user_code: `${TAG}adm`, password_hash: await bcrypt.hash('Spare#Admin1', 4), mobile: '9000000000', full_name: 'Spare Admin', role: 'admin',
    failed_login_attempts: 3, locked_until: new Date(Date.now() + 600000),
  }).returning('id');
  spareAdminId = idOf(s);
  const realAdminHash = (await db('users').where({ id: admin.id }).first('password_hash')).password_hash;
  const epoch0 = (await db('users').where({ id: spareAdminId }).first()).token_epoch || 0;

  const r = await resetAdminPassword(`${TAG}adm`);
  assert.equal(r.username, `${TAG}adm`);
  const u = await db('users').where({ id: spareAdminId }).first();
  assert.equal(await bcrypt.compare(r.password, u.password_hash), true);
  assert.equal(u.token_epoch, epoch0 + 1);
  assert.equal(u.locked_until, null);
  assert.equal(u.must_change_password, false, 'the admin is not forced through the user flow');
  assert.equal((await db('users').where({ id: admin.id }).first('password_hash')).password_hash, realAdminHash, 'the real admin is untouched');
  await assert.rejects(() => resetAdminPassword(`${TAG}nobody`), /No admin account/);
});
