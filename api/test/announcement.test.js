'use strict';

// Announcements on the user panels: GET /api/announcements/mine gives a managed user the active announcements for their own user type
// plus the ones for everybody (userTypeId 'all' = stored with no user type). Inactive ones, other types' ones, the admin and visitors are kept out.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3936;
const BASE = `http://localhost:${PORT}`;
const TAG = `an${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let A; let typeA; let typeB; let userA; let userB; const made = [];

const as = async (id) => api(BASE, signFor(await db('users').where({ id }).first()));
const messages = (r) => r.b.rows.map((x) => x.message).filter((m) => m.startsWith(TAG));

before(async () => {
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  typeA = idOf((await db('user_types').insert({ name: `${TAG} A` }).returning('id'))[0]);
  typeB = idOf((await db('user_types').insert({ name: `${TAG} B` }).returning('id'))[0]);
  const hash = await bcrypt.hash('x', 4);
  const mk = async (n, typeId) => idOf((await db('users').insert({
    username: `${TAG}${n}`, user_code: `${TAG}${n}`, password_hash: hash, mobile: '9000000000', full_name: `Ann ${n}`, role: 'user', user_type_id: typeId, wallet_balance: 0,
  }).returning('id'))[0]);
  userA = await mk('a', typeA); userB = await mk('b', typeB);
});

after(async () => {
  await db('announcements').where('message', 'like', `${TAG}%`).del();
  await db('users').whereIn('id', [userA, userB]).del();
  await db('user_types').whereIn('id', [typeA, typeB]).del();
  await new Promise((x) => server.close(x));
  await db.destroy();
});

test('the admin can make an announcement for one user type or for all users', async () => {
  const one = await A.post('/api/announcements', { userTypeId: typeA, message: `${TAG} only A` });
  assert.equal(one.s, 201, JSON.stringify(one.b)); made.push(one.b.row.id);
  assert.equal(one.b.row.user_type_id, typeA);
  const all = await A.post('/api/announcements', { userTypeId: 'all', message: `${TAG} everybody` });
  assert.equal(all.s, 201, JSON.stringify(all.b)); made.push(all.b.row.id);
  assert.equal(all.b.row.user_type_id, null, 'for all users = no user type');
  const off = await A.post('/api/announcements', { userTypeId: 'all', message: `${TAG} switched off`, isActive: false });
  assert.equal(off.s, 201); made.push(off.b.row.id);
  assert.equal((await A.post('/api/announcements', { userTypeId: 99999999, message: `${TAG} bad type` })).s, 400, 'a type that does not exist is still refused');
  assert.equal((await A.post('/api/announcements', { message: `${TAG} no type` })).s, 400, 'no type at all is still refused');
});

test('a user sees the announcements for their own type and for everybody, not other types\' ones and not switched-off ones', async () => {
  const a = await (await as(userA)).get('/api/announcements/mine');
  assert.equal(a.s, 200, JSON.stringify(a.b));
  assert.deepEqual(messages(a).sort(), [`${TAG} everybody`, `${TAG} only A`]);
  const b = await (await as(userB)).get('/api/announcements/mine');
  assert.deepEqual(messages(b), [`${TAG} everybody`], 'the other type only gets the one for everybody');
});

test('an announcement can be moved between one type and everybody', async () => {
  const id = made[0]; // "only A"
  assert.equal((await A.put(`/api/announcements/${id}`, { userTypeId: 'all' })).s, 200);
  assert.ok(messages(await (await as(userB)).get('/api/announcements/mine')).includes(`${TAG} only A`), 'now B sees it too');
  assert.equal((await A.put(`/api/announcements/${id}`, { userTypeId: typeB })).s, 200);
  assert.ok(!messages(await (await as(userA)).get('/api/announcements/mine')).includes(`${TAG} only A`), 'now only B has it');
  assert.equal((await A.put(`/api/announcements/${id}`, { userTypeId: 'nonsense' })).s, 400);
});

test('only managed users have a panel banner: the admin and a visitor are refused', async () => {
  assert.equal((await A.get('/api/announcements/mine')).s, 403);
  assert.equal((await api(BASE, '').get('/api/announcements/mine')).s, 401);
});
