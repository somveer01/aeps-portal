'use strict';

// QA: Money Transfer (DMT) over HTTP - sender, beneficiaries, verify, transfer - on the mock provider with a throwaway
// type / retailers / wallet.
// Run: PGDATABASE=fintech_qa_a node --test --test-concurrency=1 test/qa_retailer_dmt.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, signFor, adminUser } = require('./helper');
const fixture = require('./qaFixture');
const { defineMoneySuite, providers } = require('./qaMoneySuite');
const pipeline = require('../src/services/txnPipeline.service');

let ctx; let other; let sender; let ben;
const MOBILE = '9876543210';
const GOOD = { name: 'Ravi Kumar', bankName: 'State Bank of India', accountNo: '123456789012', ifsc: 'SBIN0001234' };
const get = () => ctx;

const mkSender = async (userId, mobile = MOBILE) => (await db('dmt_senders').insert({ retailer_id: userId, mobile, name: 'Seed Sender', kyc_status: 'verified' }).returning('*'))[0];
const mkBen = async (senderId, verified = true, extra = {}) => (await db('dmt_beneficiaries').insert({ sender_id: senderId, name: 'Seed Ben', bank_name: 'HDFC Bank', account_no: '556677889900', ifsc: 'HDFC0000001', verified, ...extra }).returning('*'))[0];
const used = async () => Number((await db('dmt_senders').where({ id: sender.id }).first('used_limit')).used_limit);
const resetLimit = () => db('dmt_senders').where({ id: sender.id }).update({ used_limit: 0 });
const http = (tok) => ctx.http(tok);
const transfer = (extra = {}, tok) => http(tok).post('/api/dmt/transfer', { beneficiaryId: ben.id, amount: 10, mode: 'IMPS', txnPin: ctx.PASSWORD, ...extra });

before(async () => {
  ctx = await fixture.create({ prefix: 'qd', port: 3882 });
  other = await ctx.mkUser('b');
  sender = await mkSender(ctx.userId);
  ben = await mkBen(sender.id, true);
});
after(async () => { await ctx.cleanup(); });

// ── Money Transfer: the standard battery (verified beneficiary, correct PIN) ──
defineMoneySuite(get, {
  label: 'POST /dmt/transfer', path: '/api/dmt/transfer', title: 'Money Transfer', serviceName: 'Money Transfer', target: '556677889900', operator: 'HDFC Bank (IMPS)', mode: 'IMPS',
  stub: () => [providers.dmt, 'transfer'], body: (amount) => ({ beneficiaryId: ben.id, amount, mode: 'IMPS', txnPin: ctx.PASSWORD }),
});

// ── sender ──
test('POST /dmt/sender: registers a sender once, shows the limits, a second call returns the same sender', async () => {
  const mobile = '9123456780';
  const a = await http().post('/api/dmt/sender', { mobile });
  assert.equal(a.s, 200, JSON.stringify(a.b));
  assert.equal(a.b.sender.mobile, mobile); assert.equal(a.b.sender.kycStatus, 'verified'); assert.ok(a.b.sender.name);
  assert.equal(a.b.sender.availableLimit, 25000); assert.equal(a.b.sender.usedLimit, 0);
  const b = await http().post('/api/dmt/sender', { mobile: ` ${mobile} ` });
  assert.equal(b.b.sender.id, a.b.sender.id, 'same sender, no duplicate');
  assert.equal((await db('dmt_senders').where({ retailer_id: ctx.userId, mobile })).length, 1);
  // another retailer registering the same mobile gets their OWN sender
  const c = await http(other.token).post('/api/dmt/sender', { mobile });
  assert.notEqual(c.b.sender.id, a.b.sender.id);
});

test('POST /dmt/sender: bad mobile numbers are refused with 400 and nothing is stored', async () => {
  const before = (await db('dmt_senders').where({ retailer_id: ctx.userId })).length;
  for (const mobile of [undefined, null, '', '123456789', '12345678901', 'abcdefghij', '+919876543210', '98765 43210', '98765-43210', {}, ['9876543210', '1']]) {
    const r = await http().post('/api/dmt/sender', { mobile });
    assert.equal(r.s, 400, `mobile ${JSON.stringify(mobile)}: ${JSON.stringify(r.b)}`); assert.equal(r.b.code, 'INVALID_INPUT');
  }
  assert.equal((await db('dmt_senders').where({ retailer_id: ctx.userId })).length, before);
});

test('POST /dmt/sender: no token 401, admin 403', async () => {
  assert.equal((await http('').post('/api/dmt/sender', { mobile: MOBILE })).s, 401);
  assert.equal((await http(signFor(await adminUser())).post('/api/dmt/sender', { mobile: MOBILE })).s, 403);
});

// ── beneficiaries ──
test('POST /dmt/beneficiary: adds an unverified beneficiary (IFSC upper-cased) and GET /dmt/beneficiaries lists it newest first', async () => {
  const r = await http().post('/api/dmt/beneficiary', { senderId: sender.id, ...GOOD, ifsc: 'sbin0001234' });
  assert.equal(r.s, 201, JSON.stringify(r.b));
  assert.equal(r.b.row.verified, false); assert.equal(r.b.row.ifsc, 'SBIN0001234'); assert.equal(r.b.row.sender_id, sender.id);
  const list = await http().get(`/api/dmt/beneficiaries?senderId=${sender.id}`);
  assert.equal(list.s, 200); assert.equal(list.b.rows[0].id, r.b.row.id, 'newest first');
  assert.ok(list.b.rows.some((x) => x.id === ben.id));
  await db('dmt_beneficiaries').where({ id: r.b.row.id }).del();
});

test('POST /dmt/beneficiary: invalid name / account / IFSC are refused with 400 and nothing is stored', async () => {
  const count = async () => (await db('dmt_beneficiaries').where({ sender_id: sender.id })).length;
  const n0 = await count();
  const bad = [
    { name: 'A' }, { name: '' }, { name: undefined }, { accountNo: '12345' }, { accountNo: 'ABCDEFGH' }, { accountNo: '1'.repeat(21) }, { accountNo: '12-34-56-78' }, { accountNo: undefined },
    { ifsc: 'SBIN1234567' }, { ifsc: 'SBI00012345' }, { ifsc: 'SBIN000123' }, { ifsc: 'SBIN00012345' }, { ifsc: '' }, { ifsc: undefined }, { ifsc: '1234ABCD560' },
  ];
  for (const patch of bad) {
    const r = await http().post('/api/dmt/beneficiary', { senderId: sender.id, ...GOOD, ...patch });
    assert.equal(r.s, 400, `${JSON.stringify(patch)}: ${r.s} ${JSON.stringify(r.b)}`); assert.equal(r.b.code, 'INVALID_INPUT');
  }
  assert.equal(await count(), n0);
});

test('POST /dmt/beneficiary: [BUG] a beneficiary with no bank name is refused', async () => {
  const r = await http().post('/api/dmt/beneficiary', { senderId: sender.id, ...GOOD, bankName: undefined });
  const stored = await db('dmt_beneficiaries').where({ sender_id: sender.id }).whereRaw("bank_name = ''").del();
  assert.equal(r.s, 400, `accepted with ${r.s} (bank_name stored as an empty string; ${stored} such rows)`);
});

test('POST /dmt/beneficiary: [BUG] over-long name / bank name is refused with 400, not a database error 500', async () => {
  for (const patch of [{ name: 'N'.repeat(121) }, { bankName: 'B'.repeat(121) }]) {
    const r = await http().post('/api/dmt/beneficiary', { senderId: sender.id, ...GOOD, ...patch });
    assert.ok(r.s >= 400 && r.s < 500, `${Object.keys(patch)} too long -> ${r.s} ${JSON.stringify(r.b)}`);
  }
});

test('POST /dmt/beneficiary: [BUG] the same account cannot be added twice for one sender (duplicate beneficiary)', async () => {
  const a = await http().post('/api/dmt/beneficiary', { senderId: sender.id, ...GOOD, accountNo: '998877665544' });
  const b = await http().post('/api/dmt/beneficiary', { senderId: sender.id, ...GOOD, accountNo: '998877665544' });
  await db('dmt_beneficiaries').where({ sender_id: sender.id, account_no: '998877665544' }).del();
  assert.equal(a.s, 201);
  assert.ok(b.s >= 400 && b.s < 500, `a duplicate of the same account was accepted (${b.s})`);
});

test('beneficiary endpoints: another retailer\'s sender / beneficiary is 404 and nothing leaks or changes', async () => {
  const r1 = await http(other.token).get(`/api/dmt/beneficiaries?senderId=${sender.id}`);
  assert.equal(r1.s, 404); assert.equal(r1.b.code, 'NOT_FOUND'); assert.equal(r1.b.rows, undefined);
  const r2 = await http(other.token).post('/api/dmt/beneficiary', { senderId: sender.id, ...GOOD });
  assert.equal(r2.s, 404);
  const r3 = await http(other.token).post(`/api/dmt/beneficiary/${ben.id}/verify`, {});
  assert.equal(r3.s, 404);
  await ctx.reset(1000); await db('users').where({ id: other.id }).update({ wallet_balance: 1000 });
  const r4 = await transfer({}, other.token);
  assert.equal(r4.s, 404); assert.equal(await ctx.wallet(other.id), 1000);
  assert.equal((await db('dmt_beneficiaries').where({ sender_id: sender.id }).whereIn('name', ['Ravi Kumar'])).length, 0);
});

test('GET /dmt/beneficiaries + POST /dmt/beneficiary: [BUG] a missing / non-numeric / out-of-range senderId is a 4xx, never a 500', async () => {
  const bad = [];
  for (const q of ['', '?senderId=', '?senderId=abc', '?senderId=99999999999', '?senderId=-1']) {
    const r = await http().get(`/api/dmt/beneficiaries${q}`);
    if (!(r.s >= 400 && r.s < 500)) bad.push(`GET ${q || '(none)'} -> ${r.s}`);
  }
  for (const senderId of [undefined, 'abc', '99999999999', null, {}]) {
    const r = await http().post('/api/dmt/beneficiary', { senderId, ...GOOD });
    if (!(r.s >= 400 && r.s < 500)) bad.push(`POST beneficiary senderId ${JSON.stringify(senderId)} -> ${r.s}`);
  }
  assert.deepEqual(bad, []);
});

// ── verify ──
test('POST /dmt/beneficiary/:id/verify: marks the beneficiary verified (repeatable), charges nothing', async () => {
  await ctx.reset(1000);
  const b = await mkBen(sender.id, false);
  const r = await http().post(`/api/dmt/beneficiary/${b.id}/verify`, {});
  assert.equal(r.s, 200, JSON.stringify(r.b)); assert.equal(r.b.verified, true); assert.ok(r.b.name);
  assert.equal((await db('dmt_beneficiaries').where({ id: b.id }).first()).verified, true);
  assert.equal((await http().post(`/api/dmt/beneficiary/${b.id}/verify`, {})).s, 200);
  assert.equal(await ctx.wallet(), 1000); assert.equal((await ctx.ledger()).length, 0);
  await db('dmt_beneficiaries').where({ id: b.id }).del();
});

test('POST /dmt/beneficiary/:id/verify: unknown id is 404; [BUG] a non-numeric / out-of-range id is a 4xx, never a 500', async () => {
  assert.equal((await http().post('/api/dmt/beneficiary/999999999/verify', {})).s, 404);
  const bad = [];
  for (const id of ['abc', '99999999999', '-5']) {
    const r = await http().post(`/api/dmt/beneficiary/${id}/verify`, {});
    if (!(r.s >= 400 && r.s < 500)) bad.push(`verify/${id} -> ${r.s}`);
  }
  assert.deepEqual(bad, []);
  assert.equal((await http('').post(`/api/dmt/beneficiary/${ben.id}/verify`, {})).s, 401);
  assert.equal((await http(signFor(await adminUser())).post(`/api/dmt/beneficiary/${ben.id}/verify`, {})).s, 403);
});

// ── transfer rules beyond the generic battery ──
test('POST /dmt/transfer: receipt shape, NEFT mode, operator text and the sender limit used', async () => {
  await ctx.reset(1000); await resetLimit();
  let r = await transfer({ amount: 100, mode: 'NEFT' });
  assert.equal(r.s, 201, JSON.stringify(r.b));
  assert.equal(r.b.receipt.title, 'Money Transfer'); assert.equal(r.b.receipt.operator, 'HDFC Bank'); assert.equal(r.b.receipt.target, '556677889900');
  assert.equal(r.b.receipt.mode, 'NEFT'); assert.ok(r.b.receipt.provider.utr); assert.equal(r.b.receipt.amount, 100);
  const t = (await ctx.txns())[0];
  assert.equal(t.operator, 'HDFC Bank (NEFT)'); assert.equal(t.mode, 'NEFT');
  assert.equal(await used(), 100);
  const s = await http().post('/api/dmt/sender', { mobile: MOBILE });
  assert.equal(s.b.sender.usedLimit, 100); assert.equal(s.b.sender.availableLimit, 24900);
  await ctx.problems('dmt receipt');
});

test('POST /dmt/transfer: an unknown mode is silently sent as IMPS [NOTE: documents current behaviour]', async () => {
  await ctx.reset(1000);
  const r = await transfer({ mode: 'RTGS' });
  assert.equal(r.s, 201); assert.equal(r.b.receipt.mode, 'IMPS');
});

test('POST /dmt/transfer: an unverified beneficiary is refused (400 NOT_VERIFIED), nothing moves', async () => {
  await ctx.reset(1000);
  const b = await mkBen(sender.id, false);
  const r = await transfer({ beneficiaryId: b.id });
  assert.equal(r.s, 400); assert.equal(r.b.code, 'NOT_VERIFIED');
  assert.equal(await ctx.wallet(), 1000); assert.equal((await ctx.txns()).length, 0);
  await db('dmt_beneficiaries').where({ id: b.id }).del();
});

test('POST /dmt/transfer: a wrong / missing transaction PIN is 401 BAD_TXN_PASSWORD; a dedicated PIN replaces the login password', async () => {
  await ctx.reset(1000);
  for (const txnPin of ['wrong', '', undefined, null, 'test@1234', 123456]) {
    const r = await transfer({ txnPin });
    assert.equal(r.s, 401, `pin ${JSON.stringify(txnPin)}: ${JSON.stringify(r.b)}`); assert.equal(r.b.code, 'BAD_TXN_PASSWORD');
  }
  assert.equal(await ctx.wallet(), 1000); assert.equal((await ctx.txns()).length, 0);
  await db('users').where({ id: ctx.userId }).update({ txn_pin_hash: await bcrypt.hash('4321', 4) });
  try {
    assert.equal((await transfer({ txnPin: ctx.PASSWORD })).s, 401, 'the login password no longer works once a PIN is set');
    const r = await transfer({ txnPin: '4321' });
    assert.equal(r.s, 201, JSON.stringify(r.b));
    assert.equal(await ctx.wallet(), 990);
  } finally { await db('users').where({ id: ctx.userId }).update({ txn_pin_hash: null }); }
  await ctx.problems('dmt pin');
});

test('POST /dmt/transfer: unknown / foreign beneficiary is 404; [BUG] missing / non-numeric / out-of-range beneficiaryId is a 4xx, never a 500', async () => {
  await ctx.reset(1000);
  assert.equal((await transfer({ beneficiaryId: 999999999 })).s, 404);
  const bad = [];
  for (const beneficiaryId of [undefined, null, '', 'abc', '99999999999', -1, {}]) {
    const r = await transfer({ beneficiaryId });
    if (!(r.s >= 400 && r.s < 500)) bad.push(`beneficiaryId ${JSON.stringify(beneficiaryId)} -> ${r.s}`);
  }
  assert.deepEqual(bad, []);
  assert.equal(await ctx.wallet(), 1000);
});

test('POST /dmt/transfer: a declined transfer does not use up the sender limit; a pending one does', async () => {
  await ctx.reset(1000); await resetLimit();
  assert.equal((await transfer({ amount: 1 })).s, 402);
  assert.equal(await used(), 0, 'declined: limit untouched');
  assert.equal((await transfer({ amount: 2 })).b.receipt.status, 'pending');
  assert.equal(await used(), 2, 'pending: limit used while the money is held');
});

test('POST /dmt/transfer: [BUG] a transfer that later FAILS (pending -> failed, refunded) gives the sender limit back', async () => {
  await ctx.reset(1000); await resetLimit();
  const r = await transfer({ amount: 3 });
  assert.equal(r.b.receipt.status, 'pending');
  const t = (await ctx.txns())[0];
  await pipeline.finalize(t.id, 'failed', { source: 'status_check' });
  assert.equal(await ctx.wallet(), 1000, 'refunded');
  assert.equal(await used(), 0, `the wallet was refunded but the sender's monthly limit is still used up (${await used()})`);
});

test('POST /dmt/transfer: [BUG] the sender\'s monthly limit (Rs 25,000, shown as availableLimit) is enforced', async () => {
  await ctx.reset(100000); await resetLimit();
  const r = await transfer({ amount: 30000 });
  const w = await ctx.wallet(); const u = await used();
  await resetLimit();
  assert.ok(r.s >= 400 && r.s < 500, `Rs 30,000 sent against a Rs 25,000 monthly limit: ${r.s}, wallet now ${w}, used_limit ${u}`);
});

test('DMT sender / beneficiary / verify are not gated by KYC or the Money Transfer switch [NOTE: documents current behaviour; only transfer is]', async () => {
  await ctx.reset(1000);
  await db('users').where({ id: ctx.userId }).update({ kyc_status: 'pending' });
  await ctx.setService('Money Transfer', { is_active: false });
  try {
    assert.equal((await http().post('/api/dmt/sender', { mobile: MOBILE })).s, 200);
    assert.equal((await http().get(`/api/dmt/beneficiaries?senderId=${sender.id}`)).s, 200);
    const t = await transfer();
    assert.equal(t.s, 403, 'the transfer itself is blocked');
  } finally { await ctx.setService('Money Transfer', { is_active: true }); await db('users').where({ id: ctx.userId }).update({ kyc_status: 'verified' }); }
  assert.equal(await ctx.wallet(), 1000);
});

test('DMT lookups: no token 401, admin 403', async () => {
  for (const [m, p] of [['get', `/api/dmt/beneficiaries?senderId=${sender.id}`], ['post', '/api/dmt/beneficiary'], ['post', '/api/dmt/transfer']]) {
    assert.equal((await http('')[m](p, {})).s, 401, p);
    assert.equal((await http(signFor(await adminUser()))[m](p, {})).s, 403, p);
  }
  await ctx.problems('dmt final', ctx.userIds);
});
