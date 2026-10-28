'use strict';

// "Service wise" reports for Distributor / Super Distributor / Retailer: GET /api/retailer/report-services lists the services in MY
// reports only (for the Service dropdown), and the `service` filter narrows the Service / Commission / history reports to one service.
// Rows go into a past day nobody uses (2020-03-16); the user type and users are created here and removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3922;
const BASE = `http://localhost:${PORT}`;
const TAG = `rs${Date.now()}`;
const DAY = '2020-03-16';
const AT = `${DAY} 12:00:00+00`;
const A = `${TAG} Alpha`; const B = `${TAG} Beta`; const C = `${TAG} Gamma`; const OTHER = `${TAG} Private`;
let server; let typeId; let me; let other; let svcId; let catId;
const SVC = `${TAG} Renamed`; const OLD = `${TAG} Old Title`;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const as = async (id) => api(BASE, signFor(await db('users').where({ id }).first()));

const ledger = (userId, service, net) => ({
  user_id: userId, service_name: service, slot_type: 'percent', type_value: 1, type_value_amount: net, gst_percent: 0, gst_amount: 0,
  tds_percent: 0, tds_amount: 0, net_amount: net, wallet_txn_type: 'credit', wallet_txn_amount: net, before_balance: 0, updated_balance: net, level: 0, created_at: AT,
});

before(async () => {
  server = await startServer(PORT);
  typeId = idOf((await db('user_types').insert({ name: `${TAG} R` }).returning('id'))[0]);
  const hash = await bcrypt.hash('x', 4);
  const mk = async (n) => idOf((await db('users').insert({
    username: `${TAG}${n}`, user_code: `${TAG}${n}`, password_hash: hash, mobile: '9000000000', full_name: `Rep ${n}`, role: 'user', user_type_id: typeId, wallet_balance: 0,
  }).returning('id'))[0]);
  me = await mk('m'); other = await mk('o');
  let n = 0;
  const tx = (userId, service, amount) => { n += 1; return { user_id: userId, service, status: 'success', amount, client_ref: `${TAG}-${n}`, created_at: AT }; };
  await db('service_transactions').insert([tx(me, A, 100), tx(me, A, 50), tx(me, B, 30), tx(other, OTHER, 999)]);
  await db('commission_ledger').insert([ledger(me, A, 2), ledger(me, C, 1), ledger(other, OTHER, 5)]);
  // A Service Master service whose rows kept an OLD name (it was renamed): two rows carry its id, one older row has no id but the current title.
  catId = (await db('service_categories').orderBy('id').first('id')).id;
  svcId = idOf((await db('services').insert({ title: SVC, code: `${TAG}-svc`, service_category_id: catId, is_active: true }).returning('id'))[0]);
  await db('service_transactions').insert([
    { ...tx(me, OLD, 10), service_id: svcId }, { ...tx(me, OLD, 20), service_id: svcId }, tx(me, SVC, 5), { ...tx(other, OLD, 77), service_id: svcId },
  ]);
  await db('commission_ledger').insert([{ ...ledger(me, OLD, 3), service_id: svcId }, { ...ledger(other, OLD, 9), service_id: svcId }]);
  await db('account_transactions').insert([{ user_id: me, service_name: B, type: 'debit', amount: 30, before_balance: 30, updated_balance: 0, remark: 'x', created_at: AT }]);
});

after(async () => {
  const ids = [me, other];
  await db('commission_ledger').whereIn('user_id', ids).del();
  await db('service_transactions').whereIn('user_id', ids).del();
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).del();
  await db('services').where({ id: svcId }).del();
  await db('user_types').where({ id: typeId }).del();
  await new Promise((x) => server.close(x));
  await db.destroy();
});

test('report-services lists only the services in my own reports, sorted', async () => {
  const r = await (await as(me)).get('/api/retailer/report-services');
  assert.equal(r.s, 200, JSON.stringify(r.b));
  const names = (x) => x.map((row) => row.name);
  assert.deepEqual(names(r.b.rows).filter((n) => n.startsWith(`${TAG} `) && n !== SVC && n !== OLD), [A, B, C], 'transactions + commission + wallet history, no duplicates, nothing of the other user');
  const o = await (await as(other)).get('/api/retailer/report-services');
  assert.ok(names(o.b.rows).includes(OTHER) && !names(o.b.rows).includes(A));
});

test('the Service dropdown of each report lists only what that report can show (kind)', async () => {
  const c = await as(me);
  const mineOnly = (n) => n.startsWith(`${TAG} `) && n !== SVC && n !== OLD; // leave out the Service Master fixture of the id tests below
  const get = async (kind) => (await c.get(`/api/retailer/report-services${kind ? `?kind=${kind}` : ''}`)).b.rows.map((x) => x.name).filter(mineOnly);
  assert.deepEqual(await get('serviceReport'), [A, B], 'Service Report: only the services in my service transactions');
  for (const k of ['commission', 'gst', 'tds']) assert.deepEqual(await get(k), [A, C], `${k}: only the services I earned commission on`);
  assert.deepEqual(await get('accountHistory'), [A, B, C], 'Account History: everything in my history');
  assert.deepEqual(await get('nonsense'), [A, B, C], 'an unknown kind falls back to everything');
  assert.deepEqual(await get(), [A, B, C]);
  // wallet-history-only names (Fund Transfer, a "... Commission" credit) never reach the Service Report list
  await db('account_transactions').insert([
    { user_id: me, service_name: 'Fund Transfer', type: 'credit', amount: 1, before_balance: 0, updated_balance: 1, remark: 'x', created_at: AT },
    { user_id: me, service_name: `${A} Commission`, type: 'credit', amount: 1, before_balance: 1, updated_balance: 2, remark: 'x', created_at: AT },
  ]);
  assert.deepEqual(await get('serviceReport'), [A, B]);
  assert.ok((await c.get('/api/retailer/report-services?kind=accountHistory')).b.rows.some((x) => x.name === 'Fund Transfer'));
  await db('account_transactions').where({ user_id: me }).whereIn('service_name', ['Fund Transfer', `${A} Commission`]).del();
});

test('the service filter narrows the Service, Commission and history reports', async () => {
  const c = await as(me);
  const sr = await c.get(`/api/retailer/service-report?startDate=${DAY}&endDate=${DAY}&service=${encodeURIComponent(A)}`);
  assert.equal(sr.s, 200, JSON.stringify(sr.b));
  assert.equal(sr.b.total, 2);
  assert.ok(sr.b.rows.every((x) => x.service === A));
  const all = await c.get(`/api/retailer/service-report?startDate=${DAY}&endDate=${DAY}`);
  assert.equal(all.b.total, 6, 'without the filter every service of mine (3 + the 3 Service Master rows), never the other user');

  const cr = await c.get(`/api/retailer/commission-report?startDate=${DAY}&endDate=${DAY}&service=${encodeURIComponent(C)}`);
  assert.equal(cr.b.total, 1);
  assert.equal(cr.b.rows[0].service_name, C);

  const ah = await c.get(`/api/retailer/account-history?startDate=${DAY}&endDate=${DAY}&service=${encodeURIComponent(B)}`);
  assert.equal(ah.b.total, 1);
});

test('managed users only: the admin is refused', async () => {
  const a = api(BASE, signFor(await adminUser()));
  assert.equal((await a.get('/api/retailer/report-services')).s, 403);
});

// ── Service Master + id ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the Service Report / Commission dropdown lists Service Master services by their CURRENT title with the id; a renamed service is one option', async () => {
  const c = await as(me);
  for (const kind of ['serviceReport', 'commission', 'gst', 'tds']) {
    const rows = (await c.get(`/api/retailer/report-services?kind=${kind}`)).b.rows;
    const svc = rows.filter((x) => x.id === svcId);
    assert.equal(svc.length, 1, `${kind}: one option for the service`);
    assert.equal(svc[0].name, SVC, `${kind}: the current Service Master title, not the old name on the rows`);
    assert.ok(!rows.some((x) => x.name === OLD), `${kind}: the old name is not a second option`);
  }
  // names that match no service stay reachable as plain names
  assert.ok((await c.get('/api/retailer/report-services?kind=serviceReport')).b.rows.some((x) => x.id === null && x.name === A));
  // account history: plain names only (its wallet history has no service id)
  assert.ok((await c.get('/api/retailer/report-services?kind=accountHistory')).b.rows.every((x) => x.id === null));
});

test('the reports filter by serviceId: rows with the id plus older rows with no id whose name is the title; never another user\'s rows', async () => {
  const c = await as(me);
  const sr = await c.get(`/api/retailer/service-report?startDate=${DAY}&endDate=${DAY}&serviceId=${svcId}`);
  assert.equal(sr.s, 200, JSON.stringify(sr.b));
  assert.equal(sr.b.total, 3, '2 rows carry the id (old name) + 1 older row by its title; the other user\'s row is not mine');
  assert.equal(sr.b.rows.map((x) => Number(x.amount)).sort((a, b) => a - b).join(','), '5,10,20');
  const cr = await c.get(`/api/retailer/commission-report?startDate=${DAY}&endDate=${DAY}&serviceId=${svcId}`);
  assert.equal(cr.b.total, 1); assert.equal(Number(cr.b.rows[0].net_amount), 3);
  for (const path of ['gst-report', 'tds-report']) {
    const g = await c.get(`/api/retailer/${path}?startDate=${DAY}&endDate=${DAY}&serviceId=${svcId}`);
    assert.equal(g.b.total, 1, path);
  }
  // the plain name filter still works for older links / names without an id
  assert.equal((await c.get(`/api/retailer/service-report?startDate=${DAY}&endDate=${DAY}&service=${encodeURIComponent(A)}`)).b.total, 2);
});

test('an unknown or malformed serviceId matches nothing (never everything)', async () => {
  const c = await as(me);
  for (const v of ['99999999', 'abc', '-1', '0', '1;drop']) {
    const r = await c.get(`/api/retailer/service-report?startDate=${DAY}&endDate=${DAY}&serviceId=${encodeURIComponent(v)}`);
    assert.equal(r.s, 200, v); assert.equal(r.b.total, 0, v);
  }
});
