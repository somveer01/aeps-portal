'use strict';

// A user's name in three parts (first, optional middle, last): create / edit through the admin and the
// network panel, partial edits, validation, and the older single `name` still working.
// Throwaway types and users, removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3915;
const BASE = `http://localhost:${PORT}`;
const TAG = `nm${Date.now()}`;
let server; let admin;
const types = {}; const users = {}; const created = [];
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch
const row = (id) => db('users').where({ id }).first('first_name', 'middle_name', 'last_name', 'full_name');

async function mkType(key, parentKey) {
  const [r] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = idOf(r);
}
const body = (extra = {}) => ({ mobile: '9000000000', password: 'Test@1234', userTypeId: types.R, ...extra });

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  await mkType('D'); await mkType('R', 'D');
  const [d] = await db('users').insert({
    username: `${TAG}D`, user_code: `${TAG}D`, password_hash: 'x', mobile: '9000000000', full_name: 'Name Dist', first_name: 'Name', last_name: 'Dist',
    role: 'user', user_type_id: types.D, parent_id: admin.id, created_by: admin.id, wallet_balance: 0, kyc_status: 'verified',
  }).returning('id');
  users.D = idOf(d);
});

after(async () => {
  await db('audit_log').whereIn('event', ['user_created']).whereRaw("detail->>'newUserId' = ANY(?)", [created.map(String)]).del();
  await db('users').whereIn('id', created).del();
  await db('users').where({ id: users.D }).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  server.close();
  await db.destroy();
});

test('create with first / middle / last: stored apart, full name composed, middle optional', async () => {
  const a = await A();
  const full = await a.post('/api/users', body({ firstName: '  Ravi ', middleName: 'Kumar', lastName: 'Sharma ' }));
  assert.equal(full.s, 201, JSON.stringify(full.b));
  created.push(full.b.row.id);
  assert.deepEqual([full.b.row.first_name, full.b.row.middle_name, full.b.row.last_name], ['Ravi', 'Kumar', 'Sharma']);
  assert.equal(full.b.row.name, 'Ravi Kumar Sharma', 'the full name every report shows');
  assert.equal((await row(full.b.row.id)).full_name, 'Ravi Kumar Sharma');

  const noMiddle = await a.post('/api/users', body({ firstName: 'Asha', lastName: 'Verma' }));
  assert.equal(noMiddle.s, 201);
  created.push(noMiddle.b.row.id);
  assert.equal(noMiddle.b.row.middle_name, null);
  assert.equal(noMiddle.b.row.name, 'Asha Verma', 'no double space when there is no middle name');
});

test('first and last name are required; each part at most 80 characters', async () => {
  const a = await A();
  const noFirst = await a.post('/api/users', body({ firstName: '', middleName: 'K', lastName: 'Sharma' }));
  assert.equal(noFirst.s, 400);
  assert.equal(noFirst.b.code, 'INVALID_NAME');
  assert.match(noFirst.b.error, /First name/);
  const noLast = await a.post('/api/users', body({ firstName: 'Ravi', lastName: '  ' }));
  assert.equal(noLast.s, 400);
  assert.match(noLast.b.error, /Last name/);
  const tooLong = await a.post('/api/users', body({ firstName: 'R'.repeat(81), lastName: 'S' }));
  assert.equal(tooLong.s, 400);
  assert.match(tooLong.b.error, /at most 80/);
});

test('an older client that sends one name still works; it is split first / middle / last', async () => {
  const a = await A();
  const legacy = await a.post('/api/users', body({ name: 'Anil Kumar Singh Rathore' }));
  assert.equal(legacy.s, 201, JSON.stringify(legacy.b));
  created.push(legacy.b.row.id);
  assert.deepEqual([legacy.b.row.first_name, legacy.b.row.middle_name, legacy.b.row.last_name], ['Anil', 'Kumar Singh', 'Rathore']);
  assert.equal(legacy.b.row.name, 'Anil Kumar Singh Rathore');
  const one = await a.post('/api/users', body({ name: 'Madonna' }));
  assert.equal(one.s, 201);
  created.push(one.b.row.id);
  assert.deepEqual([one.b.row.first_name, one.b.row.last_name], ['Madonna', null], 'a single word is only a first name');
  const tiny = await a.post('/api/users', body({ name: 'x' }));
  assert.equal(tiny.s, 400, 'the old 2-character rule still applies to a single name');
});

test('edit: a part left out keeps its saved value; the full name follows', async () => {
  const a = await A();
  const c = await a.post('/api/users', body({ firstName: 'Neha', middleName: 'Rani', lastName: 'Gupta' }));
  created.push(c.b.row.id);
  const id = c.b.row.id;

  const onlyLast = await a.put(`/api/users/${id}`, { lastName: 'Mishra' });
  assert.equal(onlyLast.s, 200, JSON.stringify(onlyLast.b));
  assert.deepEqual([onlyLast.b.row.first_name, onlyLast.b.row.middle_name, onlyLast.b.row.last_name], ['Neha', 'Rani', 'Mishra']);
  assert.equal(onlyLast.b.row.name, 'Neha Rani Mishra');

  const dropMiddle = await a.put(`/api/users/${id}`, { firstName: 'Neha', middleName: '', lastName: 'Mishra' });
  assert.equal(dropMiddle.b.row.middle_name, null, 'an empty middle name is saved as none');
  assert.equal(dropMiddle.b.row.name, 'Neha Mishra');

  const blankLast = await a.put(`/api/users/${id}`, { lastName: '' });
  assert.equal(blankLast.s, 400, 'the last name cannot be emptied');
  assert.equal((await row(id)).last_name, 'Mishra', 'nothing changed');

  const other = await a.put(`/api/users/${id}`, { shopName: 'Neha Store' });
  assert.equal(other.s, 200);
  assert.equal(other.b.row.name, 'Neha Mishra', 'editing something else leaves the name alone');

  const legacy = await a.put(`/api/users/${id}`, { name: 'Neha Rani Mishra' });
  assert.equal(legacy.s, 200, 'an older client can still rename with one name');
  assert.deepEqual([legacy.b.row.first_name, legacy.b.row.middle_name, legacy.b.row.last_name], ['Neha', 'Rani', 'Mishra']);
});

test('a user saved before names were split is split on the next edit of any name part', async () => {
  const a = await A();
  const [u] = await db('users').insert({
    username: `${TAG}old`, user_code: `${TAG}old`, password_hash: 'x', mobile: '9000000000', full_name: 'Old Style Name', role: 'user',
    user_type_id: types.R, parent_id: admin.id, created_by: admin.id, wallet_balance: 0, kyc_status: 'verified',
  }).returning('id'); // first / middle / last left empty, like seeded or older data
  const id = idOf(u); created.push(id);
  const r = await a.put(`/api/users/${id}`, { lastName: 'Shape' });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.deepEqual([r.b.row.first_name, r.b.row.middle_name, r.b.row.last_name], ['Old', 'Style', 'Shape'], 'the saved full name was split first');
  assert.equal(r.b.row.name, 'Old Style Shape');
});

test('network panel: a distributor creates and edits a retailer with the three parts', async () => {
  const dist = api(BASE, signFor(await db('users').where({ id: users.D }).first()));
  const c = await dist.post('/api/network/users', body({ firstName: 'Sita', lastName: 'Devi' }));
  assert.equal(c.s, 201, JSON.stringify(c.b));
  created.push(c.b.row.id);
  assert.equal(c.b.row.name, 'Sita Devi');
  assert.equal((await dist.post('/api/network/users', body({ firstName: 'Sita', lastName: '' }))).s, 400, 'last name required here too');

  const e = await dist.put(`/api/network/users/${c.b.row.id}`, { middleName: 'Kumari' });
  assert.equal(e.s, 200, JSON.stringify(e.b));
  assert.deepEqual([e.b.row.first_name, e.b.row.middle_name, e.b.row.last_name], ['Sita', 'Kumari', 'Devi']);
  assert.equal(e.b.row.name, 'Sita Kumari Devi');
});
