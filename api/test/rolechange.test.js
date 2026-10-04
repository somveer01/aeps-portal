'use strict';

// Changing a user's account type (role) or parent later, over HTTP, on a throwaway type tree
// SD -> D -> R and throwaway users (all removed afterwards).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');
const usersRepo = require('../src/repositories/usersManager.repo');
const fundRequest = require('../src/services/fundRequest.service');

const PORT = 3912;
const BASE = `http://localhost:${PORT}`;
const TAG = `role${Date.now()}`;
let server; let admin;
const types = {}; const users = {}; let plan; let pkg; let ledgerRow;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch
const row = (key) => db('users').where({ id: users[key] }).first();

async function mkType(key, parentKey) {
  const [r] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = idOf(r);
}
async function mkUser(key, typeKey, parentKey, extra = {}) {
  const parentId = parentKey === 'admin' ? admin.id : users[parentKey];
  const [r] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: 'x', mobile: '9000000000', full_name: `Role ${key}`,
    role: 'user', user_type_id: types[typeKey], parent_id: parentId, created_by: parentId, wallet_balance: 0, kyc_status: 'verified', ...extra,
  }).returning('id');
  users[key] = idOf(r);
}

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  await mkType('SD'); await mkType('D', 'SD'); await mkType('R', 'D');
  [plan] = await db('plans').insert({ user_type_id: types.R, name: `${TAG} R plan` }).returning('id');
  plan = idOf(plan);
  await mkUser('SD', 'SD', 'admin');
  await mkUser('SD2', 'SD', 'admin');
  await mkUser('D1', 'D', 'SD');
  await mkUser('R1', 'R', 'D1', { plan_id: plan });
  await mkUser('R2', 'R', 'D1');
  await mkUser('R3', 'R', 'D1');
  await mkUser('Rx', 'R', 'SD2'); // a retailer outside D1's branch
  [pkg] = await db('commission_packages').insert({ owner_user_id: users.D1, name: `${TAG} pkg`, user_type_id: types.R, is_active: true }).returning('id');
  pkg = idOf(pkg);
  await db('users').whereIn('id', [users.R1, users.R2]).update({ commission_package_id: pkg });
  // A past chain payout to D1 from R2: history must never be rewritten by a role change.
  [ledgerRow] = await db('commission_ledger').insert({
    user_id: users.D1, service_name: `${TAG} svc`, slot_type: 'amount', type_value: 5, type_value_amount: 5, gst_percent: 18, gst_amount: 0.9,
    tds_percent: 5, tds_amount: 0.25, net_amount: 5.9, wallet_txn_type: 'credit', wallet_txn_amount: 5.9, before_balance: 0, updated_balance: 5.9,
    level: 1, source_user_id: users.R2,
  }).returning('id');
  ledgerRow = idOf(ledgerRow);
});

after(async () => {
  const ids = Object.values(users);
  await db('audit_log').whereIn('event', ['user_type_changed', 'user_parent_changed', 'downline_moved', 'user_created'])
    .where((w) => w.whereRaw("detail->>'targetUserId' = ANY(?)", [ids.map(String)]).orWhereRaw("detail->>'fromUserId' = ANY(?)", [ids.map(String)]).orWhereRaw("detail->>'newUserId' = ANY(?)", [ids.map(String)]))
    .del();
  await db('commission_ledger').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).update({ commission_package_id: null, parent_id: null, created_by: null });
  await db('commission_packages').where({ id: pkg }).del();
  await db('users').whereIn('id', ids).del();
  await db('plans').where({ id: plan }).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  server.close();
  await db.destroy();
});

test('promote a retailer to distributor: needs a parent that can hold a distributor; plan, package and session follow', async () => {
  const a = await A();
  const before1 = await row('R1');
  const preview = await a.get(`/api/users/${users.R1}/change-impact?userTypeId=${types.D}`);
  assert.equal(preview.s, 200);
  assert.equal(preview.b.fitsParent, false, 'a Distributor cannot sit under a Distributor');
  assert.equal(preview.b.planCleared, true);
  assert.equal(preview.b.packageCleared, true);
  assert.equal(preview.b.signsOut, true);

  const bad = await a.put(`/api/users/${users.R1}`, { userTypeId: types.D });
  assert.equal(bad.s, 400);
  assert.equal(bad.b.code, 'PARENT_TYPE_MISMATCH');

  const ok = await a.put(`/api/users/${users.R1}`, { userTypeId: types.D, parentId: users.SD });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
  const r = await row('R1');
  assert.equal(r.user_type_id, types.D);
  assert.equal(r.parent_id, users.SD);
  assert.equal(r.plan_id, null, 'the Retailer plan is removed');
  assert.equal(r.commission_package_id, null, 'the package from the old parent is removed');
  assert.equal(r.token_epoch, (before1.token_epoch || 0) + 1, 'signed out');
  assert.equal(r.created_by, before1.created_by, 'creator (fund-request approver) is unchanged');
  // The promoted user now has a network panel and may create Retailers.
  const meta = await api(BASE, signFor(r)).get('/api/network/meta');
  assert.equal(meta.s, 200);
  assert.deepEqual(meta.b.childTypes.map((t) => t.id), [types.R]);
  assert.ok(await db('audit_log').where({ event: 'user_type_changed' }).whereRaw("detail->>'targetUserId' = ?", [String(users.R1)]).first());
});

test('demote a distributor with retailers: refused until they are moved; cycle and wrong targets rejected', async () => {
  const a = await A();
  const preview = await a.get(`/api/users/${users.D1}/change-impact?userTypeId=${types.R}`);
  assert.equal(preview.b.fitsParent, true, 'a Retailer may sit under the SD');
  assert.deepEqual(preview.b.childrenMismatch.map((c) => c.id).sort(), [users.R2, users.R3].sort());
  assert.deepEqual(preview.b.ownedPackagesDeactivated.map((p) => p.id), [pkg]);

  const refused = await a.put(`/api/users/${users.D1}`, { userTypeId: types.R });
  assert.equal(refused.s, 409);
  assert.equal(refused.b.code, 'DOWNLINE_TYPE_MISMATCH');
  assert.equal(refused.b.children.length, 2);
  assert.equal((await row('D1')).user_type_id, types.D, 'nothing changed');

  const self = await a.put(`/api/users/${users.D1}`, { userTypeId: types.R, moveChildrenTo: users.D1 });
  assert.equal(self.s, 400);
  assert.equal(self.b.code, 'PARENT_CYCLE');
  const inside = await a.put(`/api/users/${users.D1}`, { userTypeId: types.R, moveChildrenTo: users.R2 });
  assert.equal(inside.s, 400);
  assert.equal(inside.b.code, 'PARENT_CYCLE', 'cannot move them under someone in the same branch');
  const wrong = await a.put(`/api/users/${users.D1}`, { userTypeId: types.R, moveChildrenTo: users.Rx });
  assert.equal(wrong.s, 400);
  assert.equal(wrong.b.code, 'PARENT_TYPE_MISMATCH', 'a Retailer cannot hold Retailers');
});

test('a failure inside the save leaves nothing changed (one transaction)', async () => {
  const a = await A();
  const orig = usersRepo.update;
  usersRepo.update = async (...args) => { await orig(...args); throw new Error('boom after the user row was written'); };
  try {
    const r = await a.put(`/api/users/${users.D1}`, { userTypeId: types.R, moveChildrenTo: users.SD });
    assert.equal(r.s, 500);
  } finally { usersRepo.update = orig; }
  assert.equal((await row('D1')).user_type_id, types.D, 'the type change was rolled back');
  assert.equal((await row('R2')).parent_id, users.D1, 'children not moved');
});

test('demote with moveChildrenTo: children move, owned packages switch off, history stays', async () => {
  const a = await A();
  const before1 = await row('D1');
  const ok = await a.put(`/api/users/${users.D1}`, { userTypeId: types.R, moveChildrenTo: users.SD });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
  assert.equal(ok.b.moved, 2);
  const d1 = await row('D1');
  assert.equal(d1.user_type_id, types.R);
  assert.equal(d1.parent_id, users.SD, 'parent unchanged (a Retailer fits under the SD)');
  assert.equal(d1.token_epoch, (before1.token_epoch || 0) + 1);
  for (const key of ['R2', 'R3']) {
    // eslint-disable-next-line no-await-in-loop
    const c = await row(key);
    assert.equal(c.parent_id, users.SD);
    assert.equal(c.commission_package_id, null, 'package from the old parent removed');
  }
  assert.equal((await db('commission_packages').where({ id: pkg }).first()).is_active, false);
  const l = await db('commission_ledger').where({ id: ledgerRow }).first();
  assert.equal(l.user_id, users.D1);
  assert.equal(l.level, 1);
  assert.equal(l.source_user_id, users.R2, 'past commission is never rewritten');
  // The fund-request approver stays the creator even though the parent changed.
  assert.equal((await fundRequest.approverFor(users.R2)).id, users.D1);
  assert.ok(await db('audit_log').where({ event: 'downline_moved' }).whereRaw("detail->>'fromUserId' = ?", [String(users.D1)]).first());
});

test('an edit that does not touch type or parent is not re-checked', async () => {
  const a = await A();
  // Rx sits under SD2; make that parent "wrong" by hand (legacy data), then edit only the name.
  await db('users').where({ id: users.Rx }).update({ parent_id: users.R3 });
  const r = await a.put(`/api/users/${users.Rx}`, { name: 'Role Rx renamed' });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal((await row('Rx')).parent_id, users.R3, 'left as it was');
  await db('users').where({ id: users.Rx }).update({ parent_id: users.SD2 });
});

test('delete: refused with users below or with history; a clean user is deleted', async () => {
  const a = await A();
  const withDownline = await a.del(`/api/users/${users.SD}`);
  assert.equal(withDownline.s, 409);
  assert.equal(withDownline.b.code, 'HAS_DOWNLINE');
  const withHistory = await a.del(`/api/users/${users.D1}`); // has a ledger row
  assert.equal(withHistory.s, 409);
  assert.equal(withHistory.b.code, 'HAS_HISTORY');
  await mkUser('Clean', 'R', 'SD2');
  const ok = await a.del(`/api/users/${users.Clean}`);
  assert.equal(ok.s, 200);
  assert.equal(await row('Clean'), undefined);
  delete users.Clean;
});
