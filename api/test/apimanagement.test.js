'use strict';

// API Management: API Configuration (tokens encrypted + masked), SP keys, Product Switch, Customer Switch,
// routing in the money pipeline, provider-wise margin and callbacks. Throwaway service / user / APIs, removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { db, startServer, api, signFor, adminUser } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');
const providers = require('../src/services/providers.service');
const router = require('../src/services/providerRouter.service');
const secretBox = require('../src/utils/secretBox');

const PORT = 3921;
const BASE = `http://localhost:${PORT}`;
const TAG = `apim${Date.now()}`;
const CODE_A = `A${Date.now()}`.slice(0, 20);
const CODE_B = `B${Date.now()}`.slice(0, 20);
let server; let svc; let userId; let mockId;
const P = {}; // provider ids by key
const A = async () => api(BASE, signFor(await adminUser()));
const bal = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let lastRoute = null;
const recharge = (amount, operator = null) => pipeline.run({
  user: { id: userId }, service: svc.title, operator, amount,
  providerCall: (clientRef, route) => { lastRoute = route; return route.api.recharge.recharge({ amount, clientRef, spKey: route.spKey }); },
});

let startedAt;
before(async () => {
  startedAt = (await db.raw('select now() as t')).rows[0].t;
  server = await startServer(PORT);
  mockId = (await db('api_providers').where({ code: 'MOCK' }).first('id')).id;
  const cat = await db('service_categories').orderBy('id').first('id');
  [svc] = await db('services').insert({ title: `${TAG} Recharge`, service_category_id: cat.id, is_active: true, provider_commission_type: 'percentage', provider_commission_value: 1 }).returning(['id', 'title']);
  const ut = await db('user_types').orderBy('id').first('id');
  const [u] = await db('users').insert({ username: TAG, user_code: TAG, password_hash: 'x', mobile: '9000000000', full_name: 'API Test', role: 'user', user_type_id: ut.id, wallet_balance: 5000, kyc_status: 'verified' }).returning('id');
  userId = idOf(u);
  await db('user_service_overrides').insert({ user_id: userId, service_id: svc.id, allowed: true });
});

after(async () => {
  const ids = Object.values(P);
  await db('admin_margins').where({ user_id: userId }).del();
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('user_service_routes').where({ user_id: userId }).del();
  await db('user_service_overrides').where({ user_id: userId }).del();
  await db('service_routes').where({ service_id: svc.id }).del();
  // Tests run one file at a time, so every API Management audit row since this file started is ours.
  await db('audit_log').whereIn('event', ['api_provider_created', 'api_provider_updated', 'api_provider_deleted', 'api_provider_tested', 'api_sp_keys_saved', 'product_switch_saved', 'customer_switch_saved'])
    .where('created_at', '>=', startedAt).del();
  await db('users').where({ id: userId }).del();
  if (ids.length) await db('api_providers').whereIn('id', ids).del();
  await db('services').where({ id: svc.id }).del();
  server.close();
  await db.destroy();
});

test('API Configuration: token stored encrypted, only a mask comes back; validation; admin only', async () => {
  const a = await A();
  const created = await a.post('/api/api-providers', {
    name: 'Test API A', code: CODE_A, adapter: 'custom', baseUrl: 'https://api.example.test/v1', username: 'demo-user',
    password: 'pw-SECRET-xyz!', token: 'tok-SECRET-9876', callbackSecret: 'cb-secret-xyz', description: 'test',
  });
  assert.equal(created.s, 201, JSON.stringify(created.b));
  P.A = created.b.row.id;
  assert.equal(created.b.row.token_masked, '••••9876');
  assert.equal(created.b.row.has_callback_secret, true);
  assert.ok(!JSON.stringify(created.b).includes('tok-SECRET-9876'), 'the token never comes back');
  assert.ok(!JSON.stringify(created.b).includes('cb-secret-xyz'), 'nor the callback secret');
  assert.ok(!JSON.stringify(created.b).includes('pw-SECRET-xyz!'), 'nor the password');
  assert.equal(created.b.row.has_password, true, 'only "a password is saved"');
  assert.equal(created.b.row.base_url, 'https://api.example.test/v1');
  const row = await db('api_providers').where({ id: P.A }).first();
  assert.notEqual(row.password_enc, 'pw-SECRET-xyz!');
  assert.equal(secretBox.decrypt(row.password_enc), 'pw-SECRET-xyz!', 'password decrypts back on the server');
  assert.notEqual(row.secret_enc, 'tok-SECRET-9876');
  assert.equal(secretBox.decrypt(row.secret_enc), 'tok-SECRET-9876', 'decrypts back on the server');

  const list = await a.get(`/api/api-providers?q=${CODE_A}`);
  assert.ok(!JSON.stringify(list.b).includes('tok-SECRET-9876'));
  assert.ok(list.b.adapters.some((x) => x.key === 'mock'));

  // Editing without a token keeps the saved one.
  const edit = await a.put(`/api/api-providers/${P.A}`, { name: 'Test API A2', token: '', password: '' });
  assert.equal(edit.s, 200);
  assert.equal(secretBox.decrypt((await db('api_providers').where({ id: P.A }).first()).password_enc), 'pw-SECRET-xyz!', 'empty password keeps the saved one');
  assert.equal((await a.put(`/api/api-providers/${P.A}`, { password: 'new-pw-1' })).s, 200);
  assert.equal(secretBox.decrypt((await db('api_providers').where({ id: P.A }).first()).password_enc), 'new-pw-1', 'a new password replaces it');
  assert.ok(!JSON.stringify(await db('audit_log').where({ event: 'api_provider_updated' }).orderBy('id', 'desc').first('detail')).includes('new-pw-1'), 'audit log never holds the password');
  assert.equal(secretBox.decrypt((await db('api_providers').where({ id: P.A }).first()).secret_enc), 'tok-SECRET-9876');

  assert.equal((await a.post('/api/api-providers', { name: 'Dup', code: CODE_A.toLowerCase(), adapter: 'custom' })).b.code, 'DUPLICATE_CODE');
  assert.equal((await a.post('/api/api-providers', { name: 'Bad', code: 'BAD1', adapter: 'custom', baseUrl: 'ftp://x' })).b.code, 'INVALID_URL');
  assert.equal((await a.post('/api/api-providers', { name: 'Bad', code: 'BAD1', adapter: 'nope' })).b.code, 'INVALID_ADAPTER');
  assert.equal((await a.del(`/api/api-providers/${mockId}`)).b.code, 'PROTECTED');
  assert.equal((await a.put(`/api/api-providers/${mockId}`, { isActive: false })).b.code, 'PROTECTED');

  const b = await a.post('/api/api-providers', { name: 'Test API B', code: CODE_B, adapter: 'custom', token: 'tok-b-1111' });
  P.B = b.b.row.id;
  const test1 = await a.post(`/api/api-providers/${P.A}/test`);
  assert.equal(test1.b.ok, true, 'mock mode: no real call, reported OK');

  const user = await db('users').where({ id: userId }).first();
  assert.equal((await api(BASE, signFor(user)).get('/api/api-providers')).s, 403);
});

test('SP keys: saved per operator, % above 100 refused, an empty row is removed', async () => {
  const a = await A();
  const get = await a.get(`/api/api-sp-keys?providerId=${P.A}&serviceId=${svc.id}`);
  assert.equal(get.s, 200);
  assert.equal(get.b.rows[0].operator, '', 'the "All operators" row first');
  assert.equal((await a.put('/api/api-sp-keys', { providerId: P.A, serviceId: svc.id, rows: [{ operator: '', spKey: 'X', commissionType: 'percent', commissionValue: 150 }] })).b.code, 'INVALID_VALUE');
  assert.equal((await a.put('/api/api-sp-keys', { providerId: P.A, serviceId: svc.id, rows: [{ operator: 'Nope', spKey: 'X', commissionType: 'percent', commissionValue: 1 }] })).b.code, 'INVALID_OPERATOR');
  const ok = await a.put('/api/api-sp-keys', { providerId: P.A, serviceId: svc.id, rows: [{ operator: '', spKey: 'SPA', commissionType: 'percent', commissionValue: 2 }] });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
  const saved = await db('provider_products').where({ provider_id: P.A, service_id: svc.id, operator: '' }).first();
  assert.equal(saved.sp_key, 'SPA');
  assert.equal(Number(saved.commission_value), 2);
  const services = await a.get(`/api/api-sp-keys/services?providerId=${P.A}`);
  assert.equal(services.b.rows.find((s) => s.id === svc.id).mapped, 1);

  // B: surcharge (B charges us); an empty row clears.
  await a.put('/api/api-sp-keys', { providerId: P.B, serviceId: svc.id, rows: [{ operator: '', spKey: 'SPB', commissionType: 'surcharge', commissionValue: 3 }] });
  await a.put('/api/api-sp-keys', { providerId: P.A, serviceId: svc.id, rows: [{ operator: '', spKey: '', commissionType: 'percent', commissionValue: 0 }] });
  assert.equal(await db('provider_products').where({ provider_id: P.A, service_id: svc.id }).first(), undefined);
  await a.put('/api/api-sp-keys', { providerId: P.A, serviceId: svc.id, rows: [{ operator: '', spKey: 'SPA', commissionType: 'percent', commissionValue: 2 }] });
});

test('no set-up: the Mock Provider is used, as before', async () => {
  const r = await recharge(10);
  assert.equal(r.status, 'success');
  assert.equal(lastRoute.providerCode, 'MOCK');
  assert.equal(lastRoute.api, providers, 'mock mode always runs the mock adapter');
  const t = await db('service_transactions').where({ client_ref: r.clientRef }).first();
  assert.equal(t.provider_id, mockId);
  const m = await db('admin_margins').where({ service_transaction_id: t.id }).first();
  assert.equal(Number(m.provider_commission), 0.1, 'Mock has no SP key row: the Service Master rate (1%)');
});

test('Product Switch: needs an SP key; the service then runs on that API with its SP key and rate', async () => {
  const a = await A();
  const other = await a.post('/api/api-providers', { name: 'No key API', code: `N${CODE_A}`.slice(0, 20), adapter: 'custom' });
  P.N = other.b.row.id;
  const refused = await a.put('/api/product-switch', { rows: [{ serviceId: svc.id, providerId: P.N }] });
  assert.equal(refused.b.code, 'PROVIDER_NOT_READY');

  const ok = await a.put('/api/product-switch', { rows: [{ serviceId: svc.id, providerId: P.A }] });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
  const list = await a.get(`/api/product-switch?q=${encodeURIComponent(TAG)}`);
  const row = list.b.rows.find((x) => x.service_id === svc.id);
  assert.equal(row.provider_id, P.A);
  assert.ok(row.ready_provider_ids.includes(P.A) && row.ready_provider_ids.includes(mockId) && !row.ready_provider_ids.includes(P.N));

  const r = await recharge(100);
  const t = await db('service_transactions').where({ client_ref: r.clientRef }).first();
  assert.equal(t.provider_id, P.A);
  assert.equal(t.sp_key, 'SPA');
  const m = await db('admin_margins').where({ service_transaction_id: t.id }).first();
  assert.equal(Number(m.provider_commission), 2, 'API A pays 2% of 100');
  assert.equal(m.provider_id, P.A);
});

test('Customer Switch: the user\'s own API wins; surcharge lowers the margin; block stops the money', async () => {
  const a = await A();
  const view = await a.get(`/api/customer-switch/${userId}`);
  const row = view.b.rows.find((x) => x.service_id === svc.id);
  assert.equal(row.default_provider_id, P.A, 'the Product Switch API is the default');
  assert.equal(row.enabled, true);

  assert.equal((await a.put(`/api/customer-switch/${userId}`, { rows: [{ serviceId: svc.id, providerId: P.B }] })).s, 200);
  const r = await recharge(100);
  const t = await db('service_transactions').where({ client_ref: r.clientRef }).first();
  assert.equal(t.provider_id, P.B);
  assert.equal(t.sp_key, 'SPB');
  const m = await db('admin_margins').where({ service_transaction_id: t.id }).first();
  assert.equal(Number(m.provider_commission), -3, 'B charges ₹3 (surcharge)');
  assert.equal(Number(m.margin), -3);

  const listed = await a.get(`/api/customer-switch?q=${TAG}`);
  assert.equal(listed.b.rows[0].api_overrides, 1);

  const before1 = await bal();
  assert.equal((await a.put(`/api/customer-switch/${userId}`, { rows: [{ serviceId: svc.id, providerId: P.B, enabled: false }] })).s, 200);
  await assert.rejects(recharge(50), (e) => e.code === 'NO_SERVICE_ACCESS');
  assert.equal(await bal(), before1, 'nothing debited');
  await a.put(`/api/customer-switch/${userId}`, { rows: [{ serviceId: svc.id, enabled: true }] });
});

test('an API switched off stops its services without debiting; exact operator row beats "All operators"', async () => {
  const a = await A();
  await a.put(`/api/api-providers/${P.B}`, { isActive: false });
  const before1 = await bal();
  await assert.rejects(recharge(50), (e) => e.code === 'PROVIDER_OFF');
  assert.equal(await bal(), before1);
  await a.put(`/api/api-providers/${P.B}`, { isActive: true });

  await db('provider_products').insert({ provider_id: P.B, service_id: svc.id, operator: 'Airtel', sp_key: 'SPB-AIRTEL', commission_type: 'flat', commission_value: 1.5 });
  const route = await router.resolve({ userId, serviceName: svc.title, operator: 'airtel' });
  assert.equal(route.spKey, 'SPB-AIRTEL');
  const other = await router.resolve({ userId, serviceName: svc.title, operator: 'Jio' });
  assert.equal(other.spKey, 'SPB');
});

test('per-API callback: signed with that API\'s secret, settles only its own transactions', async () => {
  // Back to API A (has the callback secret) for this user.
  await (await A()).put(`/api/customer-switch/${userId}`, { rows: [{ serviceId: svc.id, providerId: null }] });
  const r = await recharge(2); // mock: pending
  assert.equal(r.status, 'pending');
  const send = async (code, secret, payload) => {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const res = await fetch(`${BASE}/api/provider-callback/${code}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sig }, body });
    return { s: res.status, b: await res.json() };
  };
  assert.equal((await send(CODE_A, 'wrong', { clientRef: r.clientRef, status: 'success' })).s, 401);
  assert.equal((await send(CODE_B, 'mock-callback-secret', { clientRef: r.clientRef, status: 'success' })).s, 404, 'API B cannot settle API A\'s transaction');
  const ok = await send(CODE_A, 'cb-secret-xyz', { clientRef: r.clientRef, status: 'success' });
  assert.equal(ok.s, 200);
  assert.equal(ok.b.changed, true);
});

test('an API with transactions cannot be deleted; health lists the APIs', async () => {
  const a = await A();
  assert.equal((await a.del(`/api/api-providers/${P.A}`)).b.code, 'HAS_HISTORY');
  assert.equal((await a.del(`/api/api-providers/${P.N}`)).s, 200);
  delete P.N;
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert.ok(h.providers.some((p) => p.code === 'MOCK' && p.runsOn === 'mock'));
  assert.ok(h.providers.some((p) => p.code === CODE_A && p.runsOn === 'mock'), 'mock mode: every API runs on mock');
});
