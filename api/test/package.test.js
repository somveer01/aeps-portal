'use strict';

// Commission packages: an upline re-shares its own commission with its direct downline; the
// admin's total stays the same and nobody gives more than they earn.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, signFor } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');

const PORT = 3950;
const BASE = `http://localhost:${PORT}`;
const TAG = `pkg${Date.now()}`;
let server; let svc; let seq = 0; const types = {}; const plans = {}; const users = {}; const tok = {};
const ids = (r) => (typeof r[0] === 'object' ? r[0].id : r[0]);

async function recharge(amount = 1000) {
  await pipeline.run({ user: { id: users.R.id }, service: svc.title, amount, providerCall: () => Promise.resolve({ ref: `${TAG}-ref` }) });
  const t = await db('service_transactions').where({ user_id: users.R.id }).orderBy('id', 'desc').first('id');
  const rows = await db('commission_ledger').where({ service_transaction_id: t.id }).select('user_id', 'type_value_amount');
  const by = (u) => Number((rows.find((r) => r.user_id === u.id) || { type_value_amount: 0 }).type_value_amount);
  return { R: by(users.R), D: by(users.D), S: by(users.S) };
}
const setPackage = (user, packageId) => db('users').where({ id: user.id }).update({ commission_package_id: packageId });
async function makePackage(owner, childType, value, commissionType = 'percentage') {
  seq += 1;
  const [p] = await db('commission_packages').insert({ owner_user_id: owner.id, name: `${TAG} ${owner.username} ${value} #${seq}`, user_type_id: childType.id }).returning('id');
  const id = typeof p === 'object' ? p.id : p;
  await db('commission_package_items').insert({ package_id: id, service_id: svc.id, commission_type: commissionType, value });
  return id;
}

before(async () => {
  server = await startServer(PORT);
  const cat = await db('service_categories').orderBy('id').first('id');
  [svc] = await db('services').insert({ title: `${TAG} Recharge`, service_category_id: cat.id, is_active: true }).returning(['id', 'title']);
  types.TOP = { id: ids(await db('user_types').insert({ name: `${TAG} Top` }).returning('id')) };
  types.MID = { id: ids(await db('user_types').insert({ name: `${TAG} Mid`, parent_type_id: types.TOP.id }).returning('id')) };
  types.LOW = { id: ids(await db('user_types').insert({ name: `${TAG} Low`, parent_type_id: types.MID.id }).returning('id')) };
  for (const k of ['TOP', 'MID', 'LOW']) {
    // eslint-disable-next-line no-await-in-loop
    plans[k] = ids(await db('plans').insert({ user_type_id: types[k].id, name: `${TAG} ${k}` }).returning('id'));
  }
  const slab = (k, value, chain) => ({ user_type_id: types[k].id, service_id: svc.id, plan_id: plans[k], commission_type: 'percentage', value, min_amount: 1, max_amount: 100000, chain_type: chain, txn_type: 'credit', is_active: true });
  await db('commission_slots').insert([slab('LOW', 3, 'self'), slab('MID', 1, 'chain'), slab('TOP', 0.5, 'chain')]);
  await db('user_type_services').insert({ user_type_id: types.LOW.id, service_id: svc.id }); // Service Permissions: LOW may use it
  let parent = null;
  for (const [k, t] of [['S', 'TOP'], ['D', 'MID'], ['R', 'LOW']]) {
    // eslint-disable-next-line no-await-in-loop
    const [u] = await db('users').insert({
      username: `${TAG}${k}`, user_code: `${TAG}${k}`, password_hash: 'x', mobile: '9000000005', full_name: `Pkg ${k}`, role: 'user',
      user_type_id: types[t].id, plan_id: plans[t], parent_id: parent, wallet_balance: 100000, kyc_status: 'verified',
    }).returning(['id', 'username', 'role', 'token_epoch', 'user_type_id']);
    users[k] = u; parent = u.id;
    tok[k] = signFor(u);
  }
});

after(async () => {
  const uids = Object.values(users).map((u) => u.id);
  await db('users').whereIn('id', uids).update({ commission_package_id: null });
  for (const t of ['commission_ledger', 'account_transactions', 'admin_margins', 'service_transactions']) {
    // eslint-disable-next-line no-await-in-loop
    await db(t).whereIn('user_id', uids).del();
  }
  await db('audit_log').whereIn('user_id', uids).del();
  await db('commission_packages').whereIn('owner_user_id', uids).del();
  await db('users').whereIn('id', [users.R.id]).del();
  await db('users').whereIn('id', [users.D.id]).del();
  await db('users').whereIn('id', [users.S.id]).del();
  await db('commission_slots').where({ service_id: svc.id }).del();
  await db('plans').whereIn('id', Object.values(plans)).del();
  await db('user_types').whereIn('id', [types.LOW.id]).del();
  await db('user_types').whereIn('id', [types.MID.id]).del();
  await db('user_types').whereIn('id', [types.TOP.id]).del();
  await db('services').where({ id: svc.id }).del();
  server.close();
  await db.destroy();
});

test('without packages everyone earns the admin default', async () => {
  assert.deepEqual(await recharge(), { R: 30, D: 10, S: 5 });
});

test('a package moves money between the parent and the child only; the admin total stays the same', async () => {
  const p = await makePackage(users.D, types.LOW, 3.5);
  await setPackage(users.R, p);
  assert.deepEqual(await recharge(), { R: 35, D: 5, S: 5 });
  const low = await makePackage(users.D, types.LOW, 2);
  await setPackage(users.R, low);
  assert.deepEqual(await recharge(), { R: 20, D: 20, S: 5 }, 'giving less leaves more for the parent');
  await setPackage(users.R, null);
});

test('a parent cannot give more than it earns: the child is capped and the parent gets 0', async () => {
  await setPackage(users.R, await makePackage(users.D, types.LOW, 5));
  assert.deepEqual(await recharge(), { R: 40, D: 0, S: 5 });
  await setPackage(users.R, null);
});

test('packages at two levels: S re-shares with D, then D re-shares with R out of its new share', async () => {
  await setPackage(users.D, await makePackage(users.S, types.MID, 1.2));
  await setPackage(users.R, await makePackage(users.D, types.LOW, 3.5));
  const r = await recharge();
  assert.deepEqual(r, { R: 35, D: 7, S: 3 });
  assert.equal(r.R + r.D + r.S, 45);
  await setPackage(users.D, null); await setPackage(users.R, null);
});

test("a package only counts when it belongs to the user's current parent", async () => {
  await setPackage(users.R, await makePackage(users.S, types.LOW, 3.8)); // S is not R's parent
  assert.deepEqual(await recharge(), { R: 30, D: 10, S: 5 });
  await setPackage(users.R, null);
});

test('network API: meta shows the most I can give; save, assign (direct only), delete', async () => {
  const D = api(BASE, tok.D);
  const m = await D.get('/api/network/packages/meta');
  assert.equal(m.s, 200, JSON.stringify(m.b));
  const low = m.b.childTypes.find((t) => t.id === types.LOW.id);
  const line = low.services.find((s) => s.serviceId === svc.id);
  assert.equal(line.max, 4, 'admin default 3% + my share 1%');

  const body = (value) => ({ name: `${TAG} Gold ${value}`, userTypeId: types.LOW.id, items: [{ serviceId: svc.id, commissionType: 'percentage', value }] });
  const tooMuch = await D.post('/api/network/packages', body(4.5));
  assert.equal(tooMuch.s, 400);
  assert.equal(tooMuch.b.code, 'ABOVE_YOUR_SHARE');
  const ok = await D.post('/api/network/packages', body(3.5));
  assert.equal(ok.s, 201, JSON.stringify(ok.b));

  assert.equal((await D.put(`/api/network/users/${users.R.id}`, { commissionPackageId: ok.b.row.id })).s, 200);
  assert.equal((await db('users').where({ id: users.R.id }).first('commission_package_id')).commission_package_id, ok.b.row.id);
  const S = api(BASE, tok.S);
  const notDirect = await S.put(`/api/network/users/${users.R.id}`, { commissionPackageId: null });
  assert.equal(notDirect.s, 400, 'S is not R\'s direct parent');

  const slab = await api(BASE, tok.R).get('/api/retailer/my-commission-slab?pageSize=100');
  const row = slab.b.rows.find((x) => x.service_id === svc.id);
  assert.equal(Number(row.value), 3.5);
  assert.equal(row.package_name, `${TAG} Gold 3.5`);

  assert.equal((await D.del(`/api/network/packages/${ok.b.row.id}`)).s, 409, 'in use');
  assert.equal((await D.del(`/api/network/packages/${ok.b.row.id}?unassign=1`)).s, 200);
  assert.equal((await db('users').where({ id: users.R.id }).first('commission_package_id')).commission_package_id, null);
});
