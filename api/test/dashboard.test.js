'use strict';

// Admin dashboard + distributor network summary over HTTP (throwaway types/users, removed afterwards).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3899;
const BASE = `http://localhost:${PORT}`;
const TAG = `dash${Date.now()}`;
let server; let adminTok;
const types = {}; const users = {};

async function mkType(key, parentKey) {
  const [row] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = typeof row === 'object' ? row.id : row;
}
async function mkUser(key, typeKey, parentId = null, active = true) {
  const [row] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: `Dash ${key}`, role: 'user', user_type_id: types[typeKey], parent_id: parentId, wallet_balance: 100, is_active: active,
  }).returning('id');
  users[key] = { id: typeof row === 'object' ? row.id : row };
}
const tokFor = async (key) => signFor(await db('users').where({ id: users[key].id }).first());

before(async () => {
  server = await startServer(PORT);
  adminTok = signFor(await adminUser());
  await mkType('MD'); await mkType('DIST', 'MD'); await mkType('RET', 'DIST');
  await mkUser('MD', 'MD');
  await mkUser('D1', 'DIST', users.MD.id);
  await mkUser('R1', 'RET', users.D1.id);
  await mkUser('R2', 'RET', users.D1.id, false);
});

after(async () => {
  const ids = Object.values(users).map((u) => u.id);
  await db('audit_log').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).del();
  await db('user_types').whereIn('id', Object.values(types)).del();
  await new Promise((r) => server.close(r));
  await db.destroy();
});

test('admin dashboard returns the full summary shape', async () => {
  const r = await api(BASE, adminTok).get('/api/admin/dashboard');
  assert.strictEqual(r.s, 200, JSON.stringify(r.b));
  const b = r.b;
  for (const k of ['users', 'adminWallet', 'transactions', 'commission', 'fundRequests', 'services', 'recent', 'trend7', 'byService', 'actions']) {
    assert.ok(k in b, `missing ${k}`);
  }
  assert.ok(b.users.total >= 4 && b.users.active >= 3 && b.users.inactive >= 1);
  assert.strictEqual(b.users.total, b.users.active + b.users.inactive);
  assert.ok(b.users.byType.some((t) => t.name === `${TAG} RET` && t.count === 2));
  assert.strictEqual(b.trend7.length, 7);
  assert.ok(b.trend7.every((d) => typeof d.count === 'number' && typeof d.amount === 'number' && typeof d.commission === 'number'));
  assert.ok(Array.isArray(b.recent) && Array.isArray(b.byService));
  for (const k of ['fundRequests', 'kyc', 'pendingTxns', 'tickets']) assert.strictEqual(typeof b.actions[k], 'number');
});

test('admin dashboard is admin-only', async () => {
  assert.strictEqual((await api(BASE).get('/api/admin/dashboard')).s, 401);
  assert.strictEqual((await api(BASE, await tokFor('MD')).get('/api/admin/dashboard')).s, 403);
});

test('network summary counts the whole downline of a distributor', async () => {
  const r = await api(BASE, await tokFor('MD')).get('/api/network/summary');
  assert.strictEqual(r.s, 200, JSON.stringify(r.b));
  assert.strictEqual(r.b.downline.total, 3); // D1 + R1 + R2 (recursive)
  assert.strictEqual(r.b.downline.active, 2);
  assert.strictEqual(r.b.downline.walletTotal, 300);
  assert.ok(r.b.downline.byType.some((t) => t.name === `${TAG} RET` && t.count === 2));
  for (const k of ['txToday', 'txMonth', 'fundRequests']) assert.ok(k in r.b);
  assert.strictEqual(typeof r.b.commissionMonth, 'number');
});

test('network summary works for a distributor and is blocked for a type that cannot have a network', async () => {
  const mid = await api(BASE, await tokFor('D1')).get('/api/network/summary');
  assert.strictEqual(mid.s, 200);
  assert.strictEqual(mid.b.downline.total, 2);
  const none = await api(BASE, await tokFor('R1')).get('/api/network/summary');
  assert.strictEqual(none.s, 403);
  assert.strictEqual(none.b.code, 'NO_NETWORK');
});
