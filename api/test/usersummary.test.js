'use strict';

// User Summary report on throwaway users: transactions, commission (own / from downline), charges, wallet added, margin.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');
const fundRepo = require('../src/repositories/fundTransfer.repo');
const { computeAmounts } = require('../src/services/commission.service');

const PORT = 3893;
const BASE = `http://localhost:${PORT}`;
const TAG = `us${Date.now()}`;
const AMOUNT = 500;
let server; let admin; let adminTok; let svc; let origRate; let planId; const users = {}; const types = {}; const slabs = [];
const ok = () => Promise.resolve({ ref: `${TAG}-ref` });
const fail = () => Promise.reject(Object.assign(new Error('declined'), { status: 402, code: 'DECLINED' }));
const idOf = (r) => (typeof r === 'object' ? r.id : r);

async function mkUser(key, typeKey, parentId, wallet) {
  const [row] = await db('users').insert({
    username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: `Sum ${key}`, role: 'user', user_type_id: types[typeKey], plan_id: planId, parent_id: parentId, wallet_balance: wallet, kyc_status: 'verified',
  }).returning('id');
  users[key] = idOf(row);
}
const mkSlab = async (typeKey, commissionType, value, chainType) => {
  const [row] = await db('commission_slots').insert({
    user_type_id: types[typeKey], service_id: svc.id, plan_id: planId, commission_type: commissionType, value,
    min_amount: 1, max_amount: 10000, chain_type: chainType, txn_type: 'credit', is_active: true,
  }).returning('id');
  slabs.push(idOf(row));
};

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser(); adminTok = signFor(admin);
  svc = await db('services').orderBy('id').first('id', 'title');
  origRate = await db('services').where({ id: svc.id }).first('provider_commission_type', 'provider_commission_value');
  await db('services').where({ id: svc.id }).update({ provider_commission_type: 'percentage', provider_commission_value: 100 });
  types.D = idOf((await db('user_types').insert({ name: `${TAG} D` }).returning('id'))[0]);
  types.R = idOf((await db('user_types').insert({ name: `${TAG} R`, parent_type_id: types.D }).returning('id'))[0]);
  await db('user_type_services').insert([{ user_type_id: types.D, service_id: svc.id }, { user_type_id: types.R, service_id: svc.id }]);
  planId = idOf((await db('plans').insert({ user_type_id: types.R, name: `${TAG} plan` }).returning('id'))[0]);
  await mkUser('D', 'D', null, 0);
  await mkUser('R', 'R', users.D, 5000);
  await mkSlab('R', 'percentage', 2, 'self');
  await mkSlab('D', 'amount', 5, 'chain');
});

after(async () => {
  const ids = Object.values(users);
  await db('commission_ledger').whereIn('user_id', ids).del();
  await db('admin_margins').whereIn('user_id', ids).del();
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('service_transactions').whereIn('user_id', ids).del();
  await db('fund_transfers').whereIn('to_user_id', ids).del();
  await db('commission_slots').whereIn('id', slabs).del();
  await db('users').whereIn('id', ids).del();
  await db('plans').where({ id: planId }).del();
  await db('user_type_services').whereIn('user_type_id', Object.values(types)).del();
  await db('user_types').whereIn('id', Object.values(types)).update({ parent_type_id: null });
  await db('user_types').whereIn('id', Object.values(types)).del();
  await db('services').where({ id: svc.id }).update(origRate);
  server.close();
  await db.destroy();
});

test('one row per user with the numbers from every ledger', async () => {
  await pipeline.run({ user: { id: users.R }, service: svc.title, amount: AMOUNT, providerCall: ok });
  await assert.rejects(pipeline.run({ user: { id: users.R }, service: svc.title, amount: AMOUNT, providerCall: fail }));
  await fundRepo.transfer({ fromUserId: null, toUserId: users.R, amount: 100, transferType: 'credit' });
  const own = computeAmounts({ commissionType: 'percentage', value: 2, amount: AMOUNT }).net;
  const up = computeAmounts({ commissionType: 'amount', value: 5, amount: AMOUNT }).net;

  const r = await api(BASE, adminTok).get(`/api/user-summary-report?userId=${users.R}`);
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(r.b.total, 1);
  const row = r.b.rows[0];
  assert.equal(row.user_code, `${TAG}R`);
  assert.equal(row.txns, 2, 'the declined attempt stays in the history next to the success');
  assert.equal(row.success, 1); assert.equal(row.failed, 1); assert.equal(row.volume, AMOUNT, 'only the success counts as volume');
  assert.equal(row.own_commission, own);
  assert.equal(row.network_commission, 0);
  assert.equal(row.wallet_added, 100);
  assert.equal(row.company_margin, Math.round((AMOUNT - own - up) * 100) / 100);
  assert.equal(r.b.totals.volume, AMOUNT); assert.equal(r.b.totals.users, 1);

  const d = await api(BASE, adminTok).get(`/api/user-summary-report?userId=${users.D}`);
  assert.equal(d.b.rows[0].network_commission, up, 'the upline earned from the downline transaction');
  assert.equal(d.b.rows[0].txns, 0);
  assert.equal(d.b.rows[0].parent_code, null);
});

test('per-service drill-down, date range and refusals', async () => {
  const det = await api(BASE, adminTok).get(`/api/user-summary-report/${users.R}`);
  assert.equal(det.s, 200, JSON.stringify(det.b));
  assert.equal(det.b.services.length, 1);
  assert.equal(det.b.services[0].service, svc.title);
  assert.equal(det.b.services[0].volume, AMOUNT);
  assert.equal(det.b.user.user_code, `${TAG}R`);

  const future = await api(BASE, adminTok).get(`/api/user-summary-report/${users.R}?startDate=2999-01-01`);
  assert.equal(future.b.services.length, 0, 'nothing after the start date');
  assert.equal(future.b.user.txns, 0); assert.equal(future.b.user.own_commission, 0);
  const past = await api(BASE, adminTok).get(`/api/user-summary-report?userId=${users.R}&endDate=2000-01-01`);
  assert.equal(past.b.rows[0].txns, 0);

  // Column sort / filter come from the grid; a bad date is ignored, never a 500; the admin is not a managed user.
  assert.equal((await api(BASE, adminTok).get(`/api/user-summary-report?sort=volume&dir=desc&f_user=${TAG}`)).s, 200);
  assert.equal((await api(BASE, adminTok).get('/api/user-summary-report?startDate=not-a-date')).s, 200);
  assert.equal((await api(BASE, adminTok).get(`/api/user-summary-report/${admin.id}`)).s, 404);
  assert.equal((await api(BASE).get('/api/user-summary-report')).s, 401);
});
