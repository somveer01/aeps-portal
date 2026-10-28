'use strict';

// Services identified by code + retailer screen + id (not by their title), and the retailer tiles built from Service Master.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');
const guard = require('../src/services/serviceGuard.service');
const { operatorOptions } = require('../src/services/operatorOptions');
const { findProblems } = require('../src/services/ledgerCheck.service');

const PORT = 3895;
const BASE = `http://localhost:${PORT}`;
const TAG = `sc${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let A; let R; let typeId; let userId; let catId; const made = [];

const mkService = async (body) => {
  const r = await A.post('/api/services', { serviceCategoryId: catId, ...body });
  assert.equal(r.s, 201, JSON.stringify(r.b));
  made.push(r.b.row.id);
  await db('user_type_services').insert({ user_type_id: typeId, service_id: r.b.row.id });
  return r.b.row;
};

before(async () => {
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  catId = (await db('service_categories').orderBy('id').first('id')).id;
  typeId = idOf((await db('user_types').insert({ name: `${TAG} type` }).returning('id'))[0]);
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Svc Code', role: 'user', user_type_id: typeId, wallet_balance: 5000, kyc_status: 'verified',
  }).returning('id'))[0]);
  R = api(BASE, signFor(await db('users').where({ id: userId }).first()));
  // the built-in Mobile Recharge is allowed for this user type too (the main tile of that screen)
  const mobile = await db('services').where({ code: 'mobile-recharge' }).first('id');
  await db('user_type_services').insert({ user_type_id: typeId, service_id: mobile.id });
});

after(async () => {
  await db('commission_ledger').where({ user_id: userId }).del();
  await db('admin_margins').where({ user_id: userId }).del();
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('user_service_overrides').where({ user_id: userId }).del();
  await db('user_type_services').where({ user_type_id: typeId }).del();
  await db('users').where({ id: userId }).del();
  await db('services').whereIn('id', made).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('every built-in service has a stable code and its retailer screen; the code is unique', async () => {
  const want = { 'mobile recharge': 'mobile-recharge', 'dth recharge': 'dth-recharge', 'bill payment': 'bill-payment', 'lic payment': 'lic-payment', 'gas booking': 'gas-booking',
    'fastag recharge': 'fastag', 'move to bank': 'move-to-bank', aeps: 'aeps', 'aadhar pay': 'aadhar-pay', 'micro atm': 'micro-atm', 'money transfer': 'money-transfer',
    'flight booking': 'flight', 'hotel booking': 'hotel', 'bus booking': 'bus' };
  for (const [title, code] of Object.entries(want)) {
    const s = await db('services').whereRaw('lower(title) = ?', [title]).first('code', 'screen');
    assert.ok(s, `${title} exists`);
    assert.equal(s.code, code, `${title} code`); assert.equal(s.screen, code, `${title} screen`);
  }
  const dup = await db.raw('select lower(code) c, count(*) n from services where code is not null group by 1 having count(*) > 1');
  assert.equal(dup.rows.length, 0, 'no two services share a code');
  const orphans = await db('service_transactions').whereNull('service_id').whereIn(db.raw('lower(service)'), Object.keys(want)).count('id as c').first();
  assert.equal(Number(orphans.c), 0, 'old transactions of built-in services got their service_id');
});

test('Service Master: code is generated, validated, unique; the retailer screen comes from the registry; the screens list is served', async () => {
  const screens = await A.get('/api/services/screens');
  assert.equal(screens.s, 200);
  assert.ok(screens.b.rows.some((x) => x.key === 'mobile-recharge' && x.operatorGroup === 'mobile'));
  const auto = await mkService({ title: `${TAG} Jio Recharge`, screen: 'mobile-recharge' });
  assert.equal(auto.code, `${TAG.toLowerCase()}-jio-recharge`); assert.equal(auto.screen, 'mobile-recharge');
  const twin = await A.post('/api/services', { serviceCategoryId: catId, title: `${TAG}  Jio  Recharge!`, code: 'ab' });
  assert.equal(twin.s, 201, 'a different title is fine'); made.push(twin.b.row.id);
  assert.equal((await A.post('/api/services', { serviceCategoryId: catId, title: `${TAG} X`, code: 'Bad Code!' })).b.code, 'INVALID_CODE');
  assert.equal((await A.post('/api/services', { serviceCategoryId: catId, title: `${TAG} Y`, code: auto.code })).b.code, 'DUPLICATE_CODE');
  assert.equal((await A.post('/api/services', { serviceCategoryId: catId, title: `${TAG} Z`, screen: 'nonsense' })).b.code, 'INVALID_SCREEN');
  assert.equal((await A.put(`/api/services/${auto.id}`, { screen: '' })).b.row.screen, null, 'empty screen = no retailer tile');
  assert.equal((await A.put(`/api/services/${auto.id}`, { screen: 'mobile-recharge' })).b.row.screen, 'mobile-recharge');
});

test('the retailer tiles come from Service Master: screen + switched on + permission; the title is the Master title', async () => {
  const jio = await db('services').where({ title: `${TAG} Jio Recharge` }).first();
  const tiles = async () => (await R.get('/api/services/catalogue')).b;
  let c = await tiles();
  const t = c.b2b.find((x) => x.service === jio.code);
  assert.ok(t, 'the new service has a tile'); assert.equal(t.title, `${TAG} Jio Recharge`); assert.equal(t.screen, 'mobile-recharge');
  assert.equal(t.route, `/services/mobile-recharge?service=${jio.code}`, 'a further service on a screen carries its code');
  const main = c.b2b.find((x) => x.screen === 'mobile-recharge' && x.service === 'mobile-recharge');
  assert.ok(main, 'the main Mobile Recharge tile is there'); assert.equal(main.route, '/services/mobile-recharge');
  assert.ok(c.b2b.some((x) => x.key === 'fund-request'), 'Fund Request always shows');

  await A.put(`/api/services/${jio.id}`, { title: `${TAG} Jio Renamed` });
  c = await tiles();
  assert.equal(c.b2b.find((x) => x.service === jio.code).title, `${TAG} Jio Renamed`, 'a rename shows up, the tile does not break');

  await A.put(`/api/services/${jio.id}`, { screen: '' });
  assert.ok(!(await tiles()).b2b.some((x) => x.service === jio.code), 'no screen = no tile');
  await A.put(`/api/services/${jio.id}`, { screen: 'mobile-recharge', isActive: false });
  assert.ok(!(await tiles()).b2b.some((x) => x.service === jio.code), 'switched off = no tile');
  await A.put(`/api/services/${jio.id}`, { isActive: true });
  await db('user_type_services').where({ user_type_id: typeId, service_id: jio.id }).del();
  assert.ok(!(await tiles()).b2b.some((x) => x.service === jio.code), 'not permitted = no tile');
  await db('user_type_services').insert({ user_type_id: typeId, service_id: jio.id });

  const bus = await mkService({ title: `${TAG} Bus Extra`, screen: 'bus' });
  assert.ok((await tiles()).online.some((x) => x.service === bus.code), 'a bus-screen service lands in the Online tab');
});

test('a second service on the Mobile Recharge screen: own code, own transaction row, mobile operators; a wrong screen is refused', async () => {
  const jio = await db('services').where({ title: `${TAG} Jio Renamed` }).first();
  const ops = await operatorOptions(jio.id);
  assert.equal(ops.kind, 'operator'); assert.ok(ops.options.includes('Airtel'), 'its operators come from its screen group (mobile)');

  const bad = await R.post('/api/recharge/mobile', { service: 'aeps', number: '9000000001', operator: 'Airtel', amount: 10 });
  assert.equal(bad.s, 400); assert.equal(bad.b.code, 'SERVICE_MISMATCH');
  const unknown = await R.post('/api/recharge/mobile', { service: 'no-such-service', number: '9000000001', operator: 'Airtel', amount: 10 });
  assert.equal(unknown.b.code, 'SERVICE_MISMATCH');

  const ok = await R.post('/api/recharge/mobile', { service: jio.code, number: '9000000001', operator: 'Airtel', amount: 20 });
  assert.equal(ok.s, 201, JSON.stringify(ok.b));
  assert.equal(ok.b.receipt.title, `${TAG} Jio Renamed`);
  const row = await db('service_transactions').where({ user_id: userId }).orderBy('id', 'desc').first();
  assert.equal(row.service, `${TAG} Jio Renamed`); assert.equal(row.service_id, jio.id);
  assert.deepEqual(await findProblems({ userIds: [userId] }), []);
});

test('a service is the same service after a rename: the daily limit and the guard follow the id and the code', async () => {
  const s = await mkService({ title: `${TAG} Limited`, screen: 'dth-recharge' });
  await A.put(`/api/services/${s.id}`, { dailyLimit: 100 });
  await db('service_transactions').insert({ user_id: userId, service: `${TAG} Old Title`, service_id: s.id, amount: 80, debit_amount: 80, client_ref: `${TAG}-lim`, status: 'success' });
  await A.put(`/api/services/${s.id}`, { title: `${TAG} Limited Renamed` });
  await assert.rejects(guard.check({ userId, serviceName: s.code, amount: 30 }), (e) => e.code === 'DAILY_LIMIT', 'the 80 used under the old title still counts');
  const byTitle = await guard.findService(`${TAG} Limited Renamed`);
  assert.equal(byTitle.id, s.id, 'found by the new title too');
  assert.equal((await guard.findService(s.code.toUpperCase())).id, s.id, 'and by its code in any case');
});

test('the code is locked once the service has history; an unused service can still change it', async () => {
  const used = await db('services').where({ title: `${TAG} Jio Renamed` }).first();
  const locked = await A.put(`/api/services/${used.id}`, { code: 'brand-new-code' });
  assert.equal(locked.s, 409); assert.equal(locked.b.code, 'CODE_LOCKED');
  const fresh = await mkService({ title: `${TAG} Fresh`, screen: 'bus' });
  const changed = await A.put(`/api/services/${fresh.id}`, { code: `${TAG.toLowerCase()}-fresh-2` });
  assert.equal(changed.s, 200); assert.equal(changed.b.row.code, `${TAG.toLowerCase()}-fresh-2`);
});

test('the catalogue also carries ONE flat list of tiles (no tabs): every B2B and Online tile, in Service Master order, Fund Request last', async () => {
  const c = (await R.get('/api/services/catalogue')).b;
  assert.ok(Array.isArray(c.tiles));
  const grouped = [...c.b2b, ...c.online].map((t) => t.key).sort();
  assert.deepEqual(c.tiles.map((t) => t.key).sort(), grouped, 'the same tiles, nothing lost or added');
  assert.equal(c.tiles[c.tiles.length - 1].key, 'fund-request');
  const order = (await db('services').whereIn('screen', ['mobile-recharge', 'bus']).orderBy('id').select('code')).map((s) => s.code);
  const keys = c.tiles.map((t) => t.key);
  const idx = order.map((code) => keys.indexOf(code)).filter((i) => i >= 0);
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'a B2B and an Online tile sit together in service order, not grouped by tab');
});
