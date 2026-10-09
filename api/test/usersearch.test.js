'use strict';

// User picker search (admin + network) and the "specific user" check on commission slots.
// Throwaway types, users, plan and service; everything is removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3914;
const BASE = `http://localhost:${PORT}`;
const TAG = `usr${Date.now()}`;
let server; let admin; let svc; let plan;
const types = {}; const users = {}; const slabs = [];
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const as = async (key) => api(BASE, signFor(await db('users').where({ id: users[key] }).first()));
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch

async function mkType(key, parentKey) {
  const [r] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = idOf(r);
}
async function mkUser(key, typeKey, parentKey, extra = {}) {
  const parentId = parentKey === 'admin' ? admin.id : users[parentKey];
  const [r] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: 'x', mobile: extra.mobile || '9000000000', full_name: extra.name || `Pick ${key}`,
    shop_name: extra.shop || null, role: 'user', user_type_id: types[typeKey], parent_id: parentId, created_by: parentId, wallet_balance: 0,
    kyc_status: 'verified', is_active: extra.active !== false, pan_number: 'ABCDE1234F', aadhar_number: '123456789012',
  }).returning('id');
  users[key] = idOf(r);
}
const slotBody = (extra = {}) => ({
  userTypeId: types.R, serviceId: svc.id, planId: plan, commissionType: 'percentage', value: 1, minAmount: 1, maxAmount: 1000,
  chainType: 'self', transactionType: 'credit', ...extra,
});

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  svc = await db('services').orderBy('id').first('id');
  await mkType('SD'); await mkType('D', 'SD'); await mkType('R', 'D');
  [plan] = await db('plans').insert({ user_type_id: types.R, name: `${TAG} plan` }).returning('id');
  plan = idOf(plan);
  await mkUser('SD', 'SD', 'admin');
  await mkUser('D', 'D', 'SD');
  await mkUser('R1', 'R', 'D', { name: 'Zed Alpha', shop: 'Blue Mart', mobile: '9111111111' });
  await mkUser('R2', 'R', 'SD', { name: 'Yan Beta', active: false }); // straight under the SD, blocked
  await mkUser('Ro', 'R', 'admin', { name: 'Outsider Gamma' });
});

after(async () => {
  const ids = Object.values(users);
  await db('audit_log').whereIn('event', ['commission_slot_created', 'commission_slot_updated', 'commission_slot_deleted'])
    .whereRaw("detail::text like ?", [`%${TAG}%`]).del();
  await db('commission_slots').whereIn('id', slabs).del();
  await db('commission_slots').where({ plan_id: plan }).del();
  await db('users').whereIn('id', ids).update({ parent_id: null, created_by: null });
  await db('users').whereIn('id', ids).del();
  await db('plans').where({ id: plan }).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  server.close();
  await db.destroy();
});

test('admin search: partial code / name / shop / mobile, case-insensitive, best code match first', async () => {
  const a = await A();
  const byCode = await a.get(`/api/users/search?q=${TAG.toUpperCase()}R1`);
  assert.equal(byCode.s, 200, JSON.stringify(byCode.b));
  assert.deepEqual(byCode.b.rows.map((r) => r.id), [users.R1], 'partial code, any case');
  assert.deepEqual((await a.get('/api/users/search?q=zed alp')).b.rows.map((r) => r.id), [users.R1], 'name');
  assert.deepEqual((await a.get('/api/users/search?q=blue mart')).b.rows.map((r) => r.id), [users.R1], 'shop');
  assert.deepEqual((await a.get('/api/users/search?q=9111111111')).b.rows.map((r) => r.id), [users.R1], 'mobile');
  assert.deepEqual((await a.get(`/api/users/search?q=${TAG}`)).b.rows.length > 0, true);
  // exact code first
  const exact = await a.get(`/api/users/search?q=${TAG}R1&limit=5`);
  assert.equal(exact.b.rows[0].id, users.R1);
});

test('admin search: type filter, limit cap, exact id / userCode, slim rows only, blocked users flagged', async () => {
  const a = await A();
  const onlyR = await a.get(`/api/users/search?q=${TAG}&userTypeId=${types.R}`);
  assert.deepEqual(onlyR.b.rows.map((r) => r.id).sort(), [users.R1, users.R2, users.Ro].sort());
  const twoTypes = await a.get(`/api/users/search?q=${TAG}&userTypeId=${types.SD},${types.D}`);
  assert.deepEqual(twoTypes.b.rows.map((r) => r.id).sort(), [users.SD, users.D].sort(), 'a comma-separated list of types');
  assert.ok((await a.get('/api/users/search?limit=500')).b.rows.length <= 20, 'limit is capped at 20');
  assert.ok((await a.get('/api/users/search')).b.rows.length > 0, 'empty query still lists users');
  const one = await a.get(`/api/users/search?userCode=${TAG.toUpperCase()}R2`);
  assert.deepEqual(one.b.rows.map((r) => r.id), [users.R2], 'exact code, any case');
  assert.equal(one.b.rows[0].is_active, false);
  assert.deepEqual((await a.get(`/api/users/search?id=${users.R1}`)).b.rows.map((r) => r.id), [users.R1]);
  const keys = Object.keys(onlyR.b.rows[0]).sort();
  assert.deepEqual(keys, ['id', 'is_active', 'mobile', 'name', 'shop_name', 'user_code', 'user_type_id', 'user_type_name', 'wallet_balance']);
  assert.ok(!JSON.stringify(onlyR.b).includes('ABCDE1234F') && !JSON.stringify(onlyR.b).includes('123456789012'), 'no PAN / Aadhaar');
  const pct = await a.get('/api/users/search?q=%25');
  assert.equal(pct.s, 200, 'a % in the text does not break the query');
  assert.deepEqual(pct.b.rows, [], 'and it is not a wildcard that matches everyone');
});

test('search is admin-only for /api/users/search and downline-only for /api/network/users/search', async () => {
  assert.equal((await api(BASE).get('/api/users/search')).s, 401);
  assert.equal((await (await as('SD')).get('/api/users/search')).s, 403, 'a managed user cannot use the admin search');

  const sd = await as('SD');
  const down = await sd.get(`/api/network/users/search?q=${TAG}`);
  assert.equal(down.s, 200, JSON.stringify(down.b));
  assert.deepEqual(down.b.rows.map((r) => r.id).sort(), [users.D, users.R1, users.R2].sort(), 'whole downline, nobody outside it');
  const direct = await sd.get(`/api/network/users/search?q=${TAG}&scope=direct`);
  assert.deepEqual(direct.b.rows.map((r) => r.id).sort(), [users.D, users.R2].sort(), 'direct children only');
  assert.deepEqual((await sd.get(`/api/network/users/search?id=${users.Ro}`)).b.rows, [], 'an outsider is never returned, even by id');
  assert.deepEqual((await sd.get(`/api/network/users/search?userCode=${TAG}R1`)).b.rows.map((r) => r.id), [users.R1]);

  const d = await as('D');
  assert.deepEqual((await d.get(`/api/network/users/search?q=${TAG}`)).b.rows.map((r) => r.id), [users.R1], 'a distributor sees only its own retailers');
  const r = await (await as('R1')).get('/api/network/users/search');
  assert.equal(r.s, 403, 'a retailer without a downline gets 403');
  assert.equal(r.b.code, 'NO_NETWORK');
});

test('commission slot: specific user must exist and be of the slab\'s own type; stored in the exact login id', async () => {
  const a = await A();
  const unknown = await a.post('/api/commission-slots', slotBody({ specificUser: 'NOPE-DOES-NOT-EXIST' }));
  assert.equal(unknown.s, 400);
  assert.equal(unknown.b.code, 'INVALID_SPECIFIC_USER');
  assert.match(unknown.b.error, /No user found/);

  const wrongType = await a.post('/api/commission-slots', slotBody({ specificUser: `${TAG}D` })); // a Distributor on a Retailer slab
  assert.equal(wrongType.s, 400);
  assert.equal(wrongType.b.code, 'INVALID_SPECIFIC_USER');
  assert.match(wrongType.b.error, /is not a/);

  const ok = await a.post('/api/commission-slots', slotBody({ specificUser: `  ${TAG.toUpperCase()}R1  ` })); // other case + spaces
  assert.equal(ok.s, 201, JSON.stringify(ok.b));
  slabs.push(ok.b.row.id);
  assert.equal(ok.b.row.specific_user, `${TAG}R1`, 'saved as the user\'s exact login id');

  const none = await a.post('/api/commission-slots', slotBody({ minAmount: 2000, maxAmount: 3000 })); // no specific user = a general slab
  assert.equal(none.s, 201);
  slabs.push(none.b.row.id);
  assert.equal(none.b.row.specific_user || '', '');
});

test('commission slot update: checked only when the user or the type changes; old slabs never block other edits', async () => {
  const a = await A();
  const [legacy] = await db('commission_slots').insert({
    user_type_id: types.R, service_id: svc.id, plan_id: plan, commission_type: 'percentage', value: 1, min_amount: 5000, max_amount: 6000,
    chain_type: 'self', txn_type: 'credit', is_active: true, specific_user: 'ghost-user-from-an-old-typo',
  }).returning('id');
  const legacyId = idOf(legacy); slabs.push(legacyId);

  const toggle = await a.put(`/api/commission-slots/${legacyId}`, { isActive: false });
  assert.equal(toggle.s, 200, 'the on/off switch is not blocked');
  const rate = await a.put(`/api/commission-slots/${legacyId}`, { ...slotBody({ minAmount: 5000, maxAmount: 6000, value: 2 }), specificUser: 'ghost-user-from-an-old-typo' });
  assert.equal(rate.s, 200, JSON.stringify(rate.b));
  assert.equal(rate.b.row.specific_user, 'ghost-user-from-an-old-typo', 'unchanged value is left as it was');

  const bad = await a.put(`/api/commission-slots/${legacyId}`, { specificUser: 'still-a-ghost' });
  assert.equal(bad.s, 400, 'changing it to another unknown id is refused');
  const good = await a.put(`/api/commission-slots/${legacyId}`, { specificUser: `${TAG}R2` });
  assert.equal(good.s, 200, JSON.stringify(good.b));
  assert.equal(good.b.row.specific_user, `${TAG}R2`);
  const cleared = await a.put(`/api/commission-slots/${legacyId}`, { specificUser: '' });
  assert.equal(cleared.s, 200);
  assert.equal(cleared.b.row.specific_user || '', '', 'clearing it is always allowed');

  // Moving a slab for a Retailer user to the Distributor type makes that user invalid for it.
  await a.put(`/api/commission-slots/${legacyId}`, { specificUser: `${TAG}R2` });
  const moved = await a.put(`/api/commission-slots/${legacyId}`, { ...slotBody({ minAmount: 5000, maxAmount: 6000 }), userTypeId: types.D });
  assert.equal(moved.s, 400, 'a retailer cannot stay on a Distributor slab');
  assert.equal(moved.b.code, 'INVALID_SPECIFIC_USER');
});
