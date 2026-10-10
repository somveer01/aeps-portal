'use strict';

// Blocking a user in Users Manager signs them out for good: their tokens stop working at once and an
// unblock does not bring them back (they log in again). Throwaway type and users, removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3916;
const BASE = `http://localhost:${PORT}`;
const TAG = `bl${Date.now()}`;
let server; let admin; let typeId; let userId;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch
const epoch = async () => (await db('users').where({ id: userId }).first('token_epoch')).token_epoch || 0;

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  const [t] = await db('user_types').insert({ name: `${TAG} R` }).returning('id');
  typeId = idOf(t);
  const [u] = await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: 'x', mobile: '9000000000', full_name: 'Block Test', first_name: 'Block', last_name: 'Test',
    role: 'user', user_type_id: typeId, parent_id: admin.id, created_by: admin.id, wallet_balance: 0, kyc_status: 'verified',
  }).returning('id');
  userId = idOf(u);
});

after(async () => {
  await db('audit_log').whereIn('event', ['user_blocked', 'user_unblocked']).whereRaw("detail->>'targetUserId' = ?", [String(userId)]).del();
  await db('users').where({ id: userId }).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('block signs the user out for good; unblock does not revive the old session', async () => {
  const before0 = await epoch();
  const token = signFor(await db('users').where({ id: userId }).first());
  const asUser = api(BASE, token);
  assert.equal((await asUser.get('/api/me')).s, 200, 'active user is in');

  const a = await A();
  const off = await a.put(`/api/users/${userId}`, { isActive: false });
  assert.equal(off.s, 200, JSON.stringify(off.b));
  assert.equal(off.b.row.is_active, false);
  assert.equal(await epoch(), before0 + 1, 'blocking bumps token_epoch');
  const blocked = await asUser.get('/api/me');
  assert.equal(blocked.s, 401);
  assert.equal(blocked.b.code, 'INACTIVE');

  const again = await a.put(`/api/users/${userId}`, { isActive: false });
  assert.equal(again.s, 200);
  assert.equal(await epoch(), before0 + 1, 'saving an already blocked user changes nothing');

  const on = await a.put(`/api/users/${userId}`, { isActive: true });
  assert.equal(on.s, 200);
  const stale = await asUser.get('/api/me');
  assert.equal(stale.s, 401, 'the session from before the block stays dead');
  assert.equal(stale.b.code, 'TOKEN_REVOKED');
  const fresh = api(BASE, signFor(await db('users').where({ id: userId }).first()));
  assert.equal((await fresh.get('/api/me')).s, 200, 'a new login works');

  const events = await db('audit_log').whereIn('event', ['user_blocked', 'user_unblocked']).whereRaw("detail->>'targetUserId' = ?", [String(userId)]).pluck('event');
  assert.deepEqual(events.sort(), ['user_blocked', 'user_unblocked']);
});

test('editing an active user without blocking leaves the session alone', async () => {
  const token = signFor(await db('users').where({ id: userId }).first());
  const asUser = api(BASE, token);
  const a = await A();
  const r = await a.put(`/api/users/${userId}`, { shopName: 'Shop Stays' });
  assert.equal(r.s, 200);
  assert.equal((await asUser.get('/api/me')).s, 200);
});
