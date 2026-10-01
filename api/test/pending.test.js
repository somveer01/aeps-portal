'use strict';

// Pending transactions → status check / signed callback / admin settle / reconciliation,
// through the real mock provider (amount 2 = pending→success, 3 = pending→failed).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { db, startServer, api, signFor, adminUser } = require('./helper');
const env = require('../src/config/env');
const pipeline = require('../src/services/txnPipeline.service');
const providers = require('../src/services/providers.service');
const recon = require('../src/services/reconciliation.service');

const PORT = 3902;
const BASE = `http://localhost:${PORT}`;
const TAG = `pnd${Date.now()}`;
let server; let userId; let svc; let planId; let slabId; let adminTok;
const runIds = [];
const recharge = (amount) => pipeline.run({ user: { id: userId }, service: svc.title, amount, providerCall: () => providers.recharge.recharge({ amount }) });
const bal = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);
const txn = (clientRef) => db('service_transactions').where({ client_ref: clientRef }).first();
const sign = (body) => crypto.createHmac('sha256', env.providerCallbackSecret).update(body).digest('hex');
async function callback(payload, signature) {
  const body = JSON.stringify(payload);
  const r = await fetch(`${BASE}/api/provider-callback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': signature || sign(body) }, body });
  return { s: r.status, b: await r.json() };
}

before(async () => {
  server = await startServer(PORT);
  adminTok = signFor(await adminUser());
  const cat = await db('service_categories').orderBy('id').first('id');
  [svc] = await db('services').insert({ title: `${TAG} Recharge`, service_category_id: cat.id, is_active: true }).returning(['id', 'title']);
  const ut = await db('user_types').orderBy('id').first('id');
  const [p] = await db('plans').insert({ user_type_id: ut.id, name: `${TAG} plan` }).returning('id');
  planId = typeof p === 'object' ? p.id : p;
  const [s] = await db('commission_slots').insert({ user_type_id: ut.id, service_id: svc.id, plan_id: planId, commission_type: 'percentage', value: 10, min_amount: 1, max_amount: 1000, chain_type: 'self', txn_type: 'credit', is_active: true }).returning('id');
  slabId = typeof s === 'object' ? s.id : s;
  const [u] = await db('users').insert({ username: TAG, user_code: TAG, password_hash: 'x', mobile: '9000000000', full_name: 'Pending Test', role: 'user', user_type_id: ut.id, plan_id: planId, wallet_balance: 1000, kyc_status: 'verified' }).returning('id');
  userId = typeof u === 'object' ? u.id : u;
  await db('user_service_overrides').insert({ user_id: userId, service_id: svc.id, allowed: true }); // Service Permissions
});

after(async () => {
  if (runIds.length) await db('reconciliation_runs').whereIn('id', runIds).del();
  const ids = (await db('service_transactions').where({ user_id: userId }).select('id')).map((r) => r.id);
  await db('audit_log').where({ event: 'provider_callback_mismatch' }).whereRaw("(detail->>'serviceTransactionId')::int = any(?)", [ids]).del();
  await db('audit_log').where({ user_id: userId }).del();
  await db('commission_ledger').where({ user_id: userId }).del();
  await db('admin_margins').where({ user_id: userId }).del();
  await db('account_transactions').where({ user_id: userId }).del();
  await db('service_transactions').where({ user_id: userId }).del();
  await db('users').where({ id: userId }).del();
  await db('commission_slots').where({ id: slabId }).del();
  await db('plans').where({ id: planId }).del();
  await db('services').where({ id: svc.id }).del();
  server.close();
  await db.destroy();
});

test('pending: money stays debited, nothing paid out yet', async () => {
  const r = await recharge(2);
  assert.equal(r.status, 'pending');
  assert.equal(r.commission, 0);
  assert.equal(await bal(), 998);
  const t = await txn(r.clientRef);
  assert.equal(t.status, 'pending');
  assert.equal(Number(t.debit_amount), 2);
  assert.equal(await db('commission_ledger').where({ service_transaction_id: t.id }).first(), undefined);
  assert.equal(await db('admin_margins').where({ service_transaction_id: t.id }).first(), undefined);
});

test('status check settles pending → success and pays commission once', async () => {
  const t = await db('service_transactions').where({ user_id: userId, status: 'pending' }).first();
  const r = await recon.checkOne(t);
  assert.equal(r.status, 'success');
  assert.ok(r.changed);
  const row = await db('service_transactions').where({ id: t.id }).first();
  assert.equal(row.finalized_by, 'status_check');
  assert.equal(row.check_count, 1);
  assert.equal(await bal(), 998.24); // 10% of ₹2 = 0.20 + 18% GST
  assert.ok(await db('admin_margins').where({ service_transaction_id: t.id }).first(), 'admin margin recorded');
  const again = await recon.checkOne(row);
  assert.equal(again.changed, false);
  assert.equal(await bal(), 998.24, 'no second payout');
});

test('signed callback: bad signature refused; failure refunds exactly once', async () => {
  const r = await recharge(3);
  assert.equal(r.status, 'pending');
  assert.equal(await bal(), 995.24);
  assert.equal((await callback({ clientRef: r.clientRef, status: 'failed' }, 'deadbeef')).s, 401);
  assert.equal((await callback({ clientRef: 'NOPE', status: 'failed' })).s, 404);

  const cb = await callback({ clientRef: r.clientRef, status: 'failed', providerRef: 'P123' });
  assert.equal(cb.s, 200);
  assert.equal(cb.b.changed, true);
  assert.equal(await bal(), 998.24, 'refunded');
  assert.equal((await txn(r.clientRef)).finalized_by, 'callback');

  const repeat = await callback({ clientRef: r.clientRef, status: 'failed' });
  assert.equal(repeat.b.changed, false);
  const flip = await callback({ clientRef: r.clientRef, status: 'success' });
  assert.equal(flip.b.changed, false);
  assert.equal(await bal(), 998.24, 'no double refund, no payout after failure');
  assert.ok(await db('audit_log').where({ event: 'provider_callback_mismatch' }).whereRaw("(detail->>'serviceTransactionId')::int = ?", [(await txn(r.clientRef)).id]).first(), 'mismatch flagged');
});

test('admin: sees pending, must write a note, settles once', async () => {
  const r = await recharge(2);
  const t = await txn(r.clientRef);
  const list = await api(BASE, adminTok).get(`/api/pending-transactions?q=${TAG}`);
  assert.ok(list.b.rows.some((x) => x.id === t.id));
  assert.equal((await api(BASE, signFor(await db('users').where({ id: userId }).first())).get('/api/pending-transactions')).s, 403);
  assert.equal((await api(BASE, adminTok).put(`/api/pending-transactions/${t.id}`, { status: 'failed' })).b.code, 'NOTE_REQUIRED');
  const ok = await api(BASE, adminTok).put(`/api/pending-transactions/${t.id}`, { status: 'failed', note: 'Provider ticket #42: failed' });
  assert.equal(ok.b.status, 'failed');
  assert.equal(await bal(), 998.24);
  assert.equal((await api(BASE, adminTok).put(`/api/pending-transactions/${t.id}`, { status: 'success', note: 'again' })).b.code, 'ALREADY_FINAL');
});

test('reconciliation: settles pending from the report and flags real mismatches', async () => {
  const pend = await recharge(2); // provider report says success
  const bad = await recharge(10); // success for us...
  await db('service_transactions').where({ client_ref: bad.clientRef }).update({ amount: 3 }); // ...but provider says failed (amount 3)
  const today = new Date(); const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const res = await api(BASE, adminTok).post('/api/reconciliation/runs', { date });
  assert.equal(res.s, 201);
  runIds.push(res.b.runId);
  const items = (await api(BASE, adminTok).get(`/api/reconciliation/runs/${res.b.runId}/items`)).b.rows;
  const mine = (ref) => items.find((i) => i.client_ref === ref);
  assert.equal(mine(pend.clientRef).type, 'AUTO_FINALIZED');
  assert.equal((await txn(pend.clientRef)).status, 'success');
  assert.equal(mine(bad.clientRef).type, 'STATUS_MISMATCH');
  assert.equal(mine(bad.clientRef).state, 'open');

  const id = mine(bad.clientRef).id;
  assert.equal((await api(BASE, adminTok).put(`/api/reconciliation/items/${id}`, { note: '' })).b.code, 'NOTE_REQUIRED');
  assert.equal((await api(BASE, adminTok).put(`/api/reconciliation/items/${id}`, { note: 'Dispute raised with provider' })).s, 200);
  assert.equal((await api(BASE, adminTok).put(`/api/reconciliation/items/${id}`, { note: 'again' })).b.code, 'NOT_OPEN');
  const runs = (await api(BASE, adminTok).get('/api/reconciliation/runs')).b.rows;
  assert.ok(runs.some((x) => x.id === res.b.runId && x.status === 'done'));
});
