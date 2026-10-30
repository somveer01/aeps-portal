'use strict';

// Account History as a bank statement: every row carries a unique Txn Id (AH + 9 digits, built from the row id), and the response has
// totals (debit / credit over the whole filter) plus opening / closing balance for one user. Rows go into a past day nobody uses (2020-03-18).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3935;
const BASE = `http://localhost:${PORT}`;
const TAG = `st${Date.now()}`;
const DAY = '2020-03-18';
let server; let typeId; let me; let other;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const as = async (id) => api(BASE, signFor(await db('users').where({ id }).first()));
const row = (userId, type, amount, before, after2, at, remark) => ({
  user_id: userId, service_name: 'Statement Test', type, amount, before_balance: before, updated_balance: after2, remark, created_at: `${DAY} ${at}+00`,
});

before(async () => {
  server = await startServer(PORT);
  typeId = idOf((await db('user_types').insert({ name: `${TAG} R` }).returning('id'))[0]);
  const hash = await bcrypt.hash('x', 4);
  const mk = async (n) => idOf((await db('users').insert({
    username: `${TAG}${n}`, user_code: `${TAG}${n}`, password_hash: hash, mobile: '9000000000', full_name: `Rep ${n}`, role: 'user', user_type_id: typeId, wallet_balance: 0,
  }).returning('id'))[0]);
  me = await mk('m'); other = await mk('o');
  await db('account_transactions').insert([
    row(me, 'credit', 100, 0, 100, '10:00:00', 'first'),
    row(me, 'debit', 30, 100, 70, '11:00:00', 'second'),
    row(me, 'credit', 5, 70, 75, '12:00:00', 'third'),
    row(other, 'credit', 999, 0, 999, '10:30:00', 'not mine'),
  ]);
});

after(async () => {
  const ids = [me, other];
  await db('account_transactions').whereIn('user_id', ids).del();
  await db('users').whereIn('id', ids).del();
  await db('user_types').where({ id: typeId }).del();
  await new Promise((x) => server.close(x));
  await db.destroy();
});

test('every row has a unique Txn Id built from its own id', async () => {
  const c = await as(me);
  const r = await c.get(`/api/retailer/account-history?startDate=${DAY}&endDate=${DAY}&pageSize=100`);
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(r.b.rows.length, 3, 'only my rows');
  const ids = r.b.rows.map((x) => x.txn_id);
  ids.forEach((t, i) => assert.equal(t, `AH${String(r.b.rows[i].id).padStart(9, '0')}`));
  assert.equal(new Set(ids).size, 3, 'unique');
});

test('totals over the whole filter, opening balance before the oldest row and closing after the newest', async () => {
  const c = await as(me);
  const r = await c.get(`/api/retailer/account-history?startDate=${DAY}&endDate=${DAY}&pageSize=1`);
  assert.equal(r.b.rows.length, 1, 'page of 1');
  assert.equal(r.b.total, 3);
  assert.deepEqual(r.b.totals, { debit: 30, credit: 105, opening: 0, closing: 75 }, 'totals are not just the visible page');
  const d = await c.get(`/api/retailer/account-history?startDate=${DAY}&endDate=${DAY}&type=debit`);
  assert.deepEqual(d.b.totals, { debit: 30, credit: 0, opening: 100, closing: 70 }, 'follows the Debit / Credit filter');
});

test('the Txn Id can be searched in the grid and an empty filter has no opening / closing', async () => {
  const c = await as(me);
  const first = (await c.get(`/api/retailer/account-history?startDate=${DAY}&endDate=${DAY}`)).b.rows[0];
  const f = await c.get(`/api/retailer/account-history?startDate=${DAY}&endDate=${DAY}&f_txn_id=${first.txn_id}`);
  assert.equal(f.b.total, 1); assert.equal(f.b.rows[0].id, first.id);
  const none = await c.get(`/api/retailer/account-history?startDate=1999-01-01&endDate=1999-01-02`);
  assert.equal(none.b.total, 0); assert.equal(none.b.totals.opening, undefined);
});

test('the admin Transaction History carries the same Txn Id and totals', async () => {
  const admin = api(BASE, signFor(await adminUser()));
  const r = await admin.get(`/api/account-history?startDate=${DAY}&endDate=${DAY}&userId=${me}`);
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.ok(r.b.rows.every((x) => /^AH\d{9}$/.test(x.txn_id)));
  assert.equal(r.b.totals.closing, 75);
  const all = await admin.get(`/api/account-history?startDate=${DAY}&endDate=${DAY}`);
  assert.equal(all.b.totals.credit, 1104, 'two users: 105 + 999'); assert.equal(all.b.totals.opening, undefined, 'no opening / closing across users');
});
