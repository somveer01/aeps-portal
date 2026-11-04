'use strict';

// Admin Wallet as a statement: GET /api/admin-wallet gives every row a unique Txn Id (AW + 9 digits) and, over the WHOLE filter, the money in
// (credit) / money out (debit) totals plus the opening balance (before the oldest row) and closing balance (after the newest row).
// Rows go into a past day nobody uses (2020-03-19) and are removed afterwards; the real admin wallet balance is never touched.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3937;
const BASE = `http://localhost:${PORT}`;
const TAG = `aw${Date.now()}`;
const DAY = '2020-03-19';
const idOf = (r) => (typeof r === 'object' ? r.id : r);
let server; let A; let adminId; let typeId; let userId;

const row = (type, amount, bef, aft, at, remark) => ({
  admin_id: adminId, txn_type: type, amount, before_balance: bef, updated_balance: aft, remark: `${TAG} ${remark}`, created_at: `${DAY} ${at}+00`,
});
const url = (extra = '') => `/api/admin-wallet?startDate=${DAY}&endDate=${DAY}${extra}`;

before(async () => {
  server = await startServer(PORT);
  const admin = await adminUser();
  adminId = admin.id; A = api(BASE, signFor(admin));
  typeId = idOf((await db('user_types').insert({ name: `${TAG} T` }).returning('id'))[0]);
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('x', 4), mobile: '9000000000', full_name: 'Aw User', role: 'user', user_type_id: typeId, wallet_balance: 0,
  }).returning('id'))[0]);
  await db('admin_wallet_transactions').insert([
    row('credit', 100, 0, 100, '10:00:00', 'top up'),
    row('debit', 30, 100, 70, '11:00:00', 'sent to user'),
    row('credit', 5, 70, 75, '12:00:00', 'taken back'),
  ]);
});

after(async () => {
  await db('admin_wallet_transactions').where('remark', 'like', `${TAG}%`).del();
  await db('users').where({ id: userId }).del();
  await db('user_types').where({ id: typeId }).del();
  await new Promise((x) => server.close(x));
  await db.destroy();
});

test('every admin wallet row has a unique Txn Id built from its own id', async () => {
  const r = await A.get(url('&pageSize=100'));
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(r.b.rows.length, 3);
  r.b.rows.forEach((x) => assert.equal(x.txn_id, `AW${String(x.id).padStart(9, '0')}`));
  assert.equal(new Set(r.b.rows.map((x) => x.txn_id)).size, 3);
});

test('money in / out totals cover the whole filter, with opening and closing balance', async () => {
  const r = await A.get(url('&pageSize=1'));
  assert.equal(r.b.rows.length, 1, 'a page of 1');
  assert.equal(r.b.total, 3);
  assert.deepEqual(r.b.totals, { credit: 105, debit: 30, opening: 0, closing: 75 }, 'not just the visible page');
  const d = await A.get(url('&txnType=debit'));
  assert.deepEqual(d.b.totals, { credit: 0, debit: 30, opening: 100, closing: 70 }, 'follows the Money In / Out filter');
});

test('the Txn Id can be searched in the grid; a filter with no rows has no opening / closing', async () => {
  const first = (await A.get(url())).b.rows[0];
  const f = await A.get(url(`&f_txn_id=${first.txn_id}`));
  assert.equal(f.b.total, 1); assert.equal(f.b.rows[0].id, first.id);
  const none = await A.get('/api/admin-wallet?startDate=1999-01-01&endDate=1999-01-02');
  assert.equal(none.b.total, 0); assert.deepEqual(none.b.totals, { credit: 0, debit: 0 });
});

test('only the admin may read it', async () => {
  const u = api(BASE, signFor(await db('users').where({ id: userId }).first()));
  assert.equal((await u.get('/api/admin-wallet')).s, 403);
  assert.equal((await api(BASE, '').get('/api/admin-wallet')).s, 401);
});

test('the Admin Wallet history menu row is called "Admin Wallet Statement" (admin menu only)', async () => {
  const row = await db('menu_items').where({ scope: 'admin', route: '/admin-wallet/all' }).first();
  assert.ok(row, 'the menu row exists');
  assert.equal(row.title, 'Admin Wallet Statement');
  const menu = await A.get('/api/menu');
  assert.equal(menu.s, 200);
  const titles = JSON.stringify(menu.b);
  assert.ok(titles.includes('Admin Wallet Statement'), 'the admin menu shows the new name');
  assert.ok(!titles.includes('"title":"View All"'), 'no menu row is still called View All');
});
