'use strict';

// Commission Report over the whole downline: who earned what from which downline user, at
// which level, through which direct child; filters, totals, per-child summary, downline-only
// security, the admin report and the missing-chain-slab warning. Throwaway types, users, slabs.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');
const { computeAmounts } = require('../src/services/commission.service');

const PORT = 3913;
const BASE = `http://localhost:${PORT}`;
const TAG = `crep${Date.now()}`;
const AMOUNT = 400;
let server; let admin; let svc; let svc2; let plan;
const types = {}; const users = {}; const slabs = [];
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const as = async (key) => api(BASE, signFor(await db('users').where({ id: users[key] }).first()));
const ok = () => Promise.resolve({ ref: `${TAG}-ref` });

async function mkType(key, parentKey) {
  const [r] = await db('user_types').insert({ name: `${TAG} ${key}`, parent_type_id: parentKey ? types[parentKey] : null }).returning('id');
  types[key] = idOf(r);
}
async function mkUser(key, typeKey, parentKey, wallet = 0) {
  const parentId = parentKey === 'admin' ? admin.id : users[parentKey];
  const [r] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: 'x', mobile: '9000000000', full_name: `Rep ${key}`,
    role: 'user', user_type_id: types[typeKey], parent_id: parentId, created_by: parentId, wallet_balance: wallet, kyc_status: 'verified',
  }).returning('id');
  users[key] = idOf(r);
}
async function mkSlab(typeKey, commissionType, value, chainType) {
  const [r] = await db('commission_slots').insert({
    user_type_id: types[typeKey], service_id: svc.id, plan_id: plan, commission_type: commissionType, value,
    min_amount: 1, max_amount: 10000, chain_type: chainType, txn_type: 'credit', is_active: true,
  }).returning('id');
  slabs.push(idOf(r));
}

const own = computeAmounts({ commissionType: 'percentage', value: 2, amount: AMOUNT });
const dist = computeAmounts({ commissionType: 'amount', value: 5, amount: AMOUNT });
const sd = computeAmounts({ commissionType: 'percentage', value: 1, amount: AMOUNT });

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  [svc, svc2] = await db('services').orderBy('id').limit(2).select('id', 'title');
  await mkType('SD'); await mkType('D', 'SD'); await mkType('R', 'D');
  [plan] = await db('plans').insert({ user_type_id: types.R, name: `${TAG} plan` }).returning('id');
  plan = idOf(plan);
  await mkSlab('R', 'percentage', 2, 'self');
  await mkSlab('D', 'amount', 5, 'chain');
  await mkSlab('SD', 'percentage', 1, 'chain');
  // SD -> D -> R1, SD -> R2 (straight under the SD), and an outsider branch SDo -> Ro.
  await mkUser('SD', 'SD', 'admin');
  await mkUser('D', 'D', 'SD');
  await mkUser('R1', 'R', 'D', 5000);
  await mkUser('R2', 'R', 'SD', 5000);
  await mkUser('SDo', 'SD', 'admin');
  await mkUser('Ro', 'R', 'SDo', 5000);
  await db('user_type_services').insert({ user_type_id: types.R, service_id: svc.id }); // Service Permissions: Retailers may use it
  for (const key of ['R1', 'R2', 'Ro']) {
    // eslint-disable-next-line no-await-in-loop
    await pipeline.run({ user: { id: users[key] }, service: svc.title, amount: AMOUNT, providerCall: ok });
  }
});

after(async () => {
  const ids = Object.values(users);
  await db('user_type_services').whereIn('user_type_id', Object.values(types)).del();
  await db('commission_ledger').whereIn('user_id', ids).del();
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('service_transactions').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).update({ parent_id: null, created_by: null });
  await db('users').whereIn('id', ids).del();
  await db('commission_slots').whereIn('id', slabs).del();
  await db('plans').where({ id: plan }).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  server.close();
  await db.destroy();
});

test('distributor sees the commission from its retailer: source name, level, via child, txn amount, totals', async () => {
  const r = await (await as('D')).get('/api/retailer/commission-report?pageSize=50');
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(r.b.rows.length, 1);
  const x = r.b.rows[0];
  assert.equal(x.level, 1);
  assert.equal(x.source_user_id, users.R1);
  assert.equal(x.source_user_name, 'Rep R1');
  assert.equal(x.source_user_type, `${TAG} R`);
  assert.equal(Number(x.txn_amount), AMOUNT);
  assert.equal(x.via_child_id, users.R1, 'R1 is a direct child of D');
  assert.equal(r.b.totals.from_downline, dist.net);
  assert.equal(r.b.totals.own, 0);
  const s = await (await as('D')).get('/api/network/summary');
  assert.equal(s.b.commissionMonth, dist.net, 'dashboard counts only what came from the downline');
});

test('super distributor sees the whole downline at every level, through the right direct child', async () => {
  const sdApi = await as('SD');
  const all = await sdApi.get('/api/retailer/commission-report?pageSize=50');
  assert.equal(all.b.rows.length, 2);
  const fromR1 = all.b.rows.find((x) => x.source_user_id === users.R1);
  const fromR2 = all.b.rows.find((x) => x.source_user_id === users.R2);
  assert.equal(fromR1.level, 2);
  assert.equal(fromR1.via_child_id, users.D, 'R1 came through D');
  assert.equal(fromR2.level, 1);
  assert.equal(fromR2.via_child_id, users.R2, 'R2 is straight under the SD');
  assert.equal(all.b.totals.from_downline, Math.round(2 * sd.net * 100) / 100);

  assert.deepEqual((await sdApi.get('/api/retailer/commission-report?level=1')).b.rows.map((x) => x.source_user_id), [users.R2]);
  assert.deepEqual((await sdApi.get('/api/retailer/commission-report?level=2')).b.rows.map((x) => x.source_user_id), [users.R1]);
  assert.deepEqual((await sdApi.get(`/api/retailer/commission-report?branchChildId=${users.D}`)).b.rows.map((x) => x.source_user_id), [users.R1]);
  assert.deepEqual((await sdApi.get(`/api/retailer/commission-report?sourceUserId=${users.R2}`)).b.rows.map((x) => x.source_user_id), [users.R2]);
  assert.equal((await sdApi.get('/api/retailer/commission-report?level=own')).b.rows.length, 0);
});

test('filters only accept users in my own downline', async () => {
  const sdApi = await as('SD');
  const foreign = await sdApi.get(`/api/retailer/commission-report?sourceUserId=${users.Ro}`);
  assert.equal(foreign.s, 404);
  assert.equal(foreign.b.code, 'NOT_IN_NETWORK');
  const notDirect = await sdApi.get(`/api/retailer/commission-report?branchChildId=${users.R1}`);
  assert.equal(notDirect.s, 404, 'R1 is below D, not a direct child of the SD');
  const dApi = await as('D');
  assert.equal((await dApi.get(`/api/retailer/commission-report?sourceUserId=${users.R2}`)).s, 404, 'R2 is not under D');
});

test('commission summary: per direct child, and the parts add up to the report totals', async () => {
  const s = await (await as('SD')).get('/api/retailer/commission-summary');
  assert.equal(s.s, 200);
  assert.equal(s.b.own, 0);
  assert.equal(s.b.fromDownline, Math.round(2 * sd.net * 100) / 100);
  const byId = Object.fromEntries(s.b.byChild.map((c) => [c.child_id, c]));
  assert.equal(byId[users.D].net, sd.net);
  assert.equal(byId[users.D].txns, 1);
  assert.equal(byId[users.R2].net, sd.net);
  const sum = s.b.byChild.reduce((t, c) => t + c.net, 0);
  assert.equal(Math.round(sum * 100) / 100, s.b.fromDownline);

  const r1 = await (await as('R1')).get('/api/retailer/commission-summary');
  assert.equal(r1.b.own, own.net);
  assert.deepEqual(r1.b.byChild, [], 'a retailer has nobody below');
  const r1rep = await (await as('R1')).get('/api/retailer/commission-report');
  assert.equal(r1rep.b.rows.length, 1);
  assert.equal(r1rep.b.rows[0].level, 0);
});

test('admin commission report: every earner, with level filter and totals', async () => {
  const a = api(BASE, signFor(await adminUser()));
  const sdRows = await a.get(`/api/commission-report?userId=${users.SD}&pageSize=50`);
  assert.equal(sdRows.s, 200);
  assert.equal(sdRows.b.rows.length, 2);
  const chainOnly = await a.get(`/api/commission-report?userId=${users.D}&level=downline`);
  assert.equal(chainOnly.b.rows.length, 1);
  assert.equal(chainOnly.b.totals.from_downline, dist.net);
  const ownOnly = await a.get(`/api/commission-report?userId=${users.R1}&level=own`);
  assert.equal(ownOnly.b.totals.own, own.net);
  assert.equal((await (await as('SD')).get('/api/commission-report')).s, 403, 'admin only');
});

test('chain-gaps warns about a type that earns nothing from its downline on a service', async () => {
  // The Retailer type may use both services; only the first has chain slabs above it.
  await db('user_type_services').insert({ user_type_id: types.R, service_id: svc2.id });
  const g = await api(BASE, signFor(await adminUser())).get('/api/commission-slots/chain-gaps');
  assert.equal(g.s, 200);
  const mine = g.b.rows.filter((x) => [types.SD, types.D].includes(x.userTypeId));
  assert.ok(mine.some((x) => x.userTypeId === types.SD && x.serviceId === svc2.id), 'SD has no chain slab on the second service');
  assert.ok(mine.some((x) => x.userTypeId === types.D && x.serviceId === svc2.id));
  assert.ok(!mine.some((x) => x.serviceId === svc.id), 'the first service is covered for both');
});
