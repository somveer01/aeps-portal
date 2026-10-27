'use strict';

// Hierarchy Tree (admin): GET /api/hierarchy-tree + the tree helpers the screen uses (app/src/utils/hierarchyTree.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { db, startServer, api, signFor, adminUser } = require('./helper');

const PORT = 3897;
const BASE = `http://localhost:${PORT}`;
const TAG = `hy${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let A; let retailerToken; let typeIds = []; const userIds = {}; let helpers;

const mkUser = async (key, typeId, parentId, extra = {}) => {
  userIds[key] = idOf((await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: `Tree ${key}`, role: 'user', user_type_id: typeId, parent_id: parentId, wallet_balance: 100, kyc_status: 'verified', ...extra,
  }).returning('id'))[0]);
  return userIds[key];
};

before(async () => {
  helpers = await import(pathToFileURL(path.join(__dirname, '..', '..', 'app', 'src', 'utils', 'hierarchyTree.js')).href);
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  const sd = idOf((await db('user_types').insert({ name: `${TAG} SD` }).returning('id'))[0]);
  const d = idOf((await db('user_types').insert({ name: `${TAG} D`, parent_type_id: sd }).returning('id'))[0]);
  const r = idOf((await db('user_types').insert({ name: `${TAG} R`, parent_type_id: d }).returning('id'))[0]);
  typeIds = [sd, d, r];
  await mkUser('sd', sd, null);
  await mkUser('d', d, userIds.sd);
  await mkUser('r1', r, userIds.d);
  await mkUser('r2', r, userIds.d, { is_active: false });
  retailerToken = signFor(await db('users').where({ id: userIds.r1 }).first());
});

after(async () => {
  await db('users').whereIn('id', Object.values(userIds)).del();
  await db('user_types').whereIn('id', [typeIds[2], typeIds[1], typeIds[0]]).del();
  server.close();
  await db.destroy();
});

test('admin gets every managed user with its parent; a user directly under the admin has parentId null', async () => {
  const r = await A.get('/api/hierarchy-tree');
  assert.equal(r.s, 200);
  const mine = r.b.rows.filter((x) => String(x.userCode).startsWith(TAG));
  assert.equal(mine.length, 4);
  const byCode = Object.fromEntries(mine.map((x) => [x.userCode.slice(TAG.length), x]));
  assert.equal(byCode.sd.parentId, null);
  assert.equal(byCode.d.parentId, userIds.sd);
  assert.equal(byCode.r1.parentId, userIds.d);
  assert.equal(byCode.r2.isActive, false);
  assert.equal(byCode.r1.walletBalance, 100);
  assert.equal(byCode.sd.userType, `${TAG} SD`);
  assert.ok(!r.b.rows.some((x) => x.userCode === 'admin'), 'the admin itself is not a row (it is the root)');
  assert.ok(!('passwordHash' in byCode.sd) && !('password_hash' in byCode.sd), 'no secrets in the answer');
});

test('only the admin may read the tree', async () => {
  assert.equal((await api(BASE, retailerToken).get('/api/hierarchy-tree')).s, 403);
  assert.equal((await api(BASE, '').get('/api/hierarchy-tree')).s, 401);
});

test('buildTree: parents, children, downline counts; unknown parents and cycles never lose or loop a user', () => {
  const { buildTree } = helpers;
  const { roots, byId } = buildTree([
    { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: 2 }, { id: 5, parentId: 999 },
  ]);
  assert.deepEqual(roots.map((n) => n.id).sort(), [1, 5], 'a parent that is not in the list makes a top-level user');
  assert.equal(byId.get(1).downline, 3); assert.equal(byId.get(2).downline, 2); assert.equal(byId.get(3).downline, 0);
  const cyc = buildTree([{ id: 10, parentId: 11 }, { id: 11, parentId: 10 }, { id: 12, parentId: null }]);
  const seen = new Set(); const walk = (n) => { seen.add(n.id); n.children.forEach(walk); }; cyc.roots.forEach((n) => { if (!seen.has(n.id)) walk(n); });
  assert.deepEqual([...seen].sort(), [10, 11, 12], 'a closed loop is still shown');
  assert.equal(buildTree([]).roots.length, 0);
});

test('filterTree: a match keeps the path to it visible and opens the parents; no filter = null', () => {
  const { buildTree, filterTree } = helpers;
  const rows = [
    { id: 1, parentId: null, userCode: 'SD1', name: 'Alpha', mobile: '1', userTypeId: 1, isActive: true },
    { id: 2, parentId: 1, userCode: 'D1', name: 'Beta', mobile: '2', userTypeId: 2, isActive: true },
    { id: 3, parentId: 2, userCode: 'R1', name: 'Gamma', mobile: '3', userTypeId: 3, isActive: false },
    { id: 4, parentId: 1, userCode: 'D2', name: 'Delta', mobile: '4', userTypeId: 2, isActive: true },
  ];
  const { roots } = buildTree(rows);
  assert.equal(filterTree(roots, { text: '', typeId: '', status: '' }), null);
  const f = filterTree(roots, { text: 'gamma', typeId: '', status: '' });
  assert.deepEqual([...f.matches], [3]); assert.deepEqual([...f.visible].sort(), [1, 2, 3]); assert.deepEqual([...f.open].sort(), [1, 2]);
  assert.deepEqual([...filterTree(roots, { text: '', typeId: '', status: 'blocked' }).matches], [3]);
  assert.deepEqual([...filterTree(roots, { text: '', typeId: 2, status: '' }).matches].sort(), [2, 4]);
  assert.equal(filterTree(roots, { text: 'zzz', typeId: '', status: '' }).visible.size, 0);
});

test('the answer carries the User Type Master tree with each type\'s depth', async () => {
  const r = await A.get('/api/hierarchy-tree');
  const mine = r.b.types.filter((t) => String(t.name).startsWith(TAG));
  const byName = Object.fromEntries(mine.map((t) => [t.name.slice(TAG.length + 1), t]));
  assert.equal(byName.SD.depth, 1); assert.equal(byName.D.depth, 2); assert.equal(byName.R.depth, 3);
  assert.equal(byName.SD.parentTypeId, null); assert.equal(byName.D.parentTypeId, byName.SD.id); assert.equal(byName.R.parentTypeId, byName.D.id);
});

test('buildTree + types: a user under a parent whose type is not above it is marked; users under the admin never are; children follow type order', () => {
  const { buildTree, filterTree } = helpers;
  const types = [{ id: 1, parentTypeId: null, depth: 1 }, { id: 2, parentTypeId: 1, depth: 2 }, { id: 3, parentTypeId: 2, depth: 3 }];
  const u = (id, parentId, typeId, name) => ({ id, parentId, userTypeId: typeId, userType: `T${typeId}`, userCode: `U${id}`, name, isActive: true });
  const { roots, byId } = buildTree([
    u(1, null, 1, 'SD'), u(2, 1, 2, 'D'), u(3, 2, 3, 'R'),            // a correct chain
    u(4, 1, 3, 'R under SD'),                                           // Retailer straight under a Super Distributor: SD is above R, fine
    u(5, 3, 2, 'D under R'),                                            // Distributor under a Retailer: wrong
    u(6, null, 3, 'R under admin'),                                     // under the admin: fine
    u(7, 2, 2, 'D under D'),                                            // same type as its parent: wrong
  ], types);
  assert.deepEqual([...byId.values()].filter((n) => n.misplaced).map((n) => n.id).sort(), [5, 7]);
  assert.match(byId.get(5).misplacedReason, /not above/);
  assert.deepEqual(byId.get(1).children.map((n) => n.id), [2, 4], 'children by type level: Distributor (2) before Retailer (3)');
  assert.deepEqual(roots.map((n) => n.id), [1, 6], 'roots by type level too');
  assert.deepEqual([...filterTree(roots, { text: '', typeId: '', status: 'misplaced' }).matches].sort(), [5, 7]);
  assert.equal([...buildTree([u(1, null, 1, 'a'), u(2, 1, 1, 'b')]).byId.values()].some((n) => n.misplaced), false, 'no types given = no marks');
});
