'use strict';

// wallet.service is the only place a wallet changes: its rules, and a guard that nothing else writes wallet_balance.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db } = require('./helper');
const wallet = require('../src/services/wallet.service');
const { findProblems } = require('../src/services/ledgerCheck.service');
const { round2, isMoneyAmount, hasMax2Decimals } = require('../src/utils/money');

const TAG = `ws${Date.now()}`;
let userId; let typeId;
const idOf = (r) => (typeof r === 'object' ? r.id : r);
const bal = async () => Number((await db('users').where({ id: userId }).first('wallet_balance')).wallet_balance);
const ledger = () => db('account_transactions').where({ user_id: userId }).orderBy('id');

before(async () => {
  typeId = idOf((await db('user_types').insert({ name: `${TAG} type` }).returning('id'))[0]);
  userId = idOf((await db('users').insert({
    username: `${TAG}u`, user_code: `${TAG}u`, password_hash: await bcrypt.hash('Test@1234', 4), mobile: '9000000000',
    full_name: 'Wallet Svc', role: 'user', user_type_id: typeId, wallet_balance: 100,
  }).returning('id'))[0]);
});

after(async () => {
  await db('account_transactions').where({ user_id: userId }).del();
  await db('users').where({ id: userId }).del();
  await db('user_types').where({ id: typeId }).del();
  await db.destroy();
});

test('credit and debit change the wallet and write one ledger row each with before / after', async () => {
  const c = await db.transaction((trx) => wallet.credit(trx, { userId, amount: 25.5, service: 'Test', remark: 'in' }));
  assert.deepEqual(c, { before: 100, after: 125.5 });
  const d = await db.transaction((trx) => wallet.debit(trx, { userId, amount: 20.25, service: 'Test', remark: 'out' }));
  assert.deepEqual(d, { before: 125.5, after: 105.25 });
  assert.equal(await bal(), 105.25);
  const rows = await ledger();
  assert.deepEqual(rows.map((r) => [r.type, Number(r.amount), Number(r.before_balance), Number(r.updated_balance), r.remark]),
    [['credit', 25.5, 100, 125.5, 'in'], ['debit', 20.25, 125.5, 105.25, 'out']]);
  assert.deepEqual(await findProblems({ userIds: [userId] }), []);
});

test('a debit below zero is refused and writes nothing', async () => {
  const before = await bal(); const rows = (await ledger()).length;
  await assert.rejects(db.transaction((trx) => wallet.debit(trx, { userId, amount: before + 0.01, service: 'Test' })), (e) => e.code === 'INSUFFICIENT_BALANCE' && e.status === 400);
  assert.equal(await bal(), before); assert.equal((await ledger()).length, rows);
  // Exactly the whole balance is allowed (wallet 0, never negative).
  await db.transaction((trx) => wallet.debit(trx, { userId, amount: before, service: 'Test' }));
  assert.equal(await bal(), 0);
  await db.transaction((trx) => wallet.credit(trx, { userId, amount: 50, service: 'Test' }));
});

test('bad input and unknown users are refused before anything is written', async () => {
  const rows = (await ledger()).length;
  await assert.rejects(db.transaction((trx) => wallet.credit(trx, { userId, amount: 0, service: 'Test' })), (e) => e.code === 'INVALID_AMOUNT');
  await assert.rejects(db.transaction((trx) => wallet.credit(trx, { userId, amount: -5, service: 'Test' })), (e) => e.code === 'INVALID_AMOUNT');
  await assert.rejects(db.transaction((trx) => wallet.apply(trx, { userId, type: 'give', amount: 5, service: 'Test' })), (e) => e.code === 'WALLET_BAD_TYPE');
  await assert.rejects(db.transaction((trx) => wallet.credit(trx, { userId: 2147483000, amount: 5, service: 'Test' })), (e) => e.code === 'WALLET_USER_NOT_FOUND');
  assert.equal((await ledger()).length, rows);
});

test('a failed transaction rolls the wallet AND its ledger row back together', async () => {
  const before = await bal(); const rows = (await ledger()).length;
  await assert.rejects(db.transaction(async (trx) => {
    await wallet.credit(trx, { userId, amount: 10, service: 'Test' });
    throw new Error('something later failed');
  }), /something later failed/);
  assert.equal(await bal(), before); assert.equal((await ledger()).length, rows);
});

test('amounts are rounded to paise and the money helpers agree', async () => {
  const w = await db.transaction((trx) => wallet.credit(trx, { userId, amount: 0.1 + 0.2, service: 'Test' }));
  assert.equal(round2(w.after - w.before), 0.3, '0.1 + 0.2 is stored as exactly 0.30');
  assert.equal(round2(2.675 * 100) / 100, Math.round(2.675 * 100 * 100) / 10000);
  assert.equal(isMoneyAmount(10.5), true); assert.equal(isMoneyAmount(10.505), false); assert.equal(isMoneyAmount(0), false);
  assert.equal(isMoneyAmount(-1), false); assert.equal(isMoneyAmount(NaN), false);
  assert.equal(hasMax2Decimals(0.1 + 0.2), true);
});

test('architecture guard: no module except wallet.service writes a wallet balance or a wallet ledger row', () => {
  const root = path.join(__dirname, '..', 'src');
  const offenders = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (!p.endsWith('.js') || p.endsWith(path.join('services', 'wallet.service.js'))) return null;
    const src = fs.readFileSync(p, 'utf8');
    if (/update\(\{\s*wallet_balance/.test(src) || /wallet_balance:\s*(db|trx)\.raw/.test(src) || /account_transactions'\)\.insert/.test(src)) offenders.push(path.relative(root, p));
    return null;
  });
  walk(root);
  assert.deepEqual(offenders, [], 'move money through services/wallet.service.js (credit / debit), not by writing wallet_balance or account_transactions directly');
});
