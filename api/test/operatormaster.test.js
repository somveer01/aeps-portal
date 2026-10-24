'use strict';

// Operator Master (admin CRUD for the operators table) and how the rest of the app sees a change.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor, adminUser } = require('./helper');
const { operatorOptions } = require('../src/services/operatorOptions');

const PORT = 3891;
const BASE = `http://localhost:${PORT}`;
const TAG = `Op${Date.now()}`;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let A; let retailer; let typeId; let userId; let mobileSvc; let createdIds = [];

before(async () => {
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  typeId = idOf((await db('user_types').insert({ name: `${TAG} type` }).returning('id'))[0]);
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Op Retailer', role: 'user', user_type_id: typeId, wallet_balance: 0, kyc_status: 'verified',
  }).returning('id'))[0]);
  retailer = api(BASE, signFor(await db('users').where({ id: userId }).first()));
  mobileSvc = await db('services').whereRaw("lower(title) = 'mobile recharge'").first('id');
});

after(async () => {
  await db('operators').where('name', 'like', `${TAG}%`).del();
  await db('audit_log').whereIn('event', ['operator_created', 'operator_updated', 'operator_deleted']).whereRaw("detail::text like ?", [`%${TAG}%`]).del();
  await db('commission_slots').where('operator', 'like', `${TAG}%`).del();
  await db('users').where({ id: userId }).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('admin only; the groups come from the services that use operators', async () => {
  assert.equal((await api(BASE).get('/api/operator-master')).s, 401);
  assert.equal((await retailer.get('/api/operator-master')).s, 403);
  const g = await A.get('/api/operator-master/groups');
  assert.deepEqual(g.b.rows.map((x) => x.key).sort(), ['bbps', 'dth', 'fastag', 'gas', 'mobile']);
});

test('create validates, refuses duplicates (same group, any letter case) and lists the new operator', async () => {
  assert.equal((await A.post('/api/operator-master', { name: 'x', service: 'mobile' })).b.code, 'INVALID_NAME');
  assert.equal((await A.post('/api/operator-master', { name: `${TAG} Telco`, service: 'nothing' })).b.code, 'INVALID_SERVICE');
  const ok = await A.post('/api/operator-master', { name: `${TAG} Telco`, service: 'mobile', category: 'Prepaid', code: 'TT', circleRequired: true });
  assert.equal(ok.s, 201, JSON.stringify(ok.b));
  createdIds.push(ok.b.row.id);
  assert.equal(ok.b.row.circle_required, true); assert.equal(ok.b.row.is_active, true);
  assert.equal((await A.post('/api/operator-master', { name: `${TAG.toUpperCase()} TELCO`, service: 'mobile' })).b.code, 'DUPLICATE');
  // the same name in another group is a different operator
  const other = await A.post('/api/operator-master', { name: `${TAG} Telco`, service: 'dth' });
  assert.equal(other.s, 201); createdIds.push(other.b.row.id);
  const list = await A.get(`/api/operator-master?q=${TAG}&service=mobile`);
  assert.equal(list.b.total, 1);
  assert.equal(list.b.rows[0].name, `${TAG} Telco`);
});

test('the retailer app, Commission Slots and SP Keys see a new operator at once, and not a switched-off one', async () => {
  const seen = async () => (await retailer.get('/api/operators?service=mobile')).b.rows.map((o) => o.name);
  assert.ok((await seen()).includes(`${TAG} Telco`), 'retailer Mobile Recharge list');
  assert.ok((await operatorOptions(mobileSvc.id)).options.includes(`${TAG} Telco`), 'slab / SP key dropdown');
  const id = createdIds[0];
  assert.equal((await A.put(`/api/operator-master/${id}`, { isActive: false })).s, 200);
  assert.ok(!(await seen()).includes(`${TAG} Telco`), 'a switched-off operator disappears from the retailer list');
  assert.ok(!(await operatorOptions(mobileSvc.id)).options.includes(`${TAG} Telco`));
  assert.equal((await A.put(`/api/operator-master/${id}`, { isActive: true })).s, 200);
});

test('an operator that is in use cannot be renamed, moved or deleted - only switched off', async () => {
  const id = createdIds[0];
  // unused: rename and move are fine
  const renamed = await A.put(`/api/operator-master/${id}`, { name: `${TAG} Telco2` });
  assert.equal(renamed.s, 200); assert.equal(renamed.b.row.name, `${TAG} Telco2`);
  // in use by a commission slab: now locked
  const ut = await db('user_types').first('id'); const plan = await db('plans').first('id');
  await db('commission_slots').insert({ user_type_id: ut.id, service_id: mobileSvc.id, plan_id: plan.id, operator: `${TAG} Telco2`, commission_type: 'percentage', value: 1, min_amount: 1, max_amount: 100, chain_type: 'self', txn_type: 'credit', is_active: true });
  const rename = await A.put(`/api/operator-master/${id}`, { name: `${TAG} Telco3` });
  assert.equal(rename.s, 409); assert.equal(rename.b.code, 'IN_USE');
  assert.equal((await A.put(`/api/operator-master/${id}`, { service: 'dth' })).b.code, 'IN_USE');
  assert.equal((await A.delete?.(`/api/operator-master/${id}`) || await A.del(`/api/operator-master/${id}`)).b.code, 'IN_USE');
  // switching off and editing the other details stay possible
  assert.equal((await A.put(`/api/operator-master/${id}`, { isActive: false, code: 'T2' })).s, 200);
  await db('commission_slots').where('operator', `${TAG} Telco2`).del();
});

test('an unused operator can be deleted, and every change is in the audit log', async () => {
  const del = await A.del(`/api/operator-master/${createdIds[1]}`);
  assert.equal(del.s, 200);
  assert.equal(await db('operators').where({ id: createdIds[1] }).first(), undefined);
  assert.equal((await A.del('/api/operator-master/2147483000')).s, 404);
  const events = (await db('audit_log').whereIn('event', ['operator_created', 'operator_updated', 'operator_deleted']).whereRaw('detail::text like ?', [`%${TAG}%`])).map((e) => e.event);
  for (const e of ['operator_created', 'operator_updated', 'operator_deleted']) assert.ok(events.includes(e), e);
});
