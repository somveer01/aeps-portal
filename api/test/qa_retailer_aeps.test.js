'use strict';

// QA: AEPS / Aadhar Pay / Micro ATM (balance enquiry, mini statement, cash withdrawal) and the AEPS device list, over HTTP
// against the mock provider, on a throwaway type / user / wallet.
// Run: PGDATABASE=fintech_qa_a node --test --test-concurrency=1 test/qa_retailer_aeps.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, signFor, adminUser } = require('./helper');
const fixture = require('./qaFixture');
const { defineMoneySuite, postUntilSettled, providers } = require('./qaMoneySuite');

let ctx;
before(async () => { ctx = await fixture.create({ prefix: 'qa', port: 3881 }); });
after(async () => { await ctx.cleanup(); });
const get = () => ctx;
const AADHAAR = '234512341234';
const MASKED = 'XXXXXXXX1234';

const ENDPOINTS = [
  { label: 'POST /aeps/transact', path: '/api/aeps/transact', title: 'AEPS', name: 'AEPS' },
  { label: 'POST /aadhar-pay/transact', path: '/api/aadhar-pay/transact', title: 'Aadhar Pay', name: 'Aadhar Pay' },
  { label: 'POST /micro-atm/transact', path: '/api/micro-atm/transact', title: 'Micro ATM', name: 'Micro ATM' },
];
const body = (extra = {}) => ({ txnType: 'balance', aadhaar: AADHAAR, bank: 'State Bank of India', deviceType: 'Morpho', mobile: '9000000001', ...extra });

// ── cash withdrawal goes through the money pipeline: the standard battery ──
for (const e of ENDPOINTS) {
  defineMoneySuite(get, {
    label: `${e.label} [withdrawal]`, path: e.path, title: e.title, serviceName: e.name, receiptTitle: `${e.name} — Cash Withdrawal`, target: MASKED, operator: 'State Bank of India',
    stub: () => [providers.aeps, 'transact'], body: (amount) => body({ txnType: 'withdrawal', amount }),
  });
}

for (const e of ENDPOINTS) {
  test(`${e.label}: txnType must be balance / mini / withdrawal`, async () => {
    await ctx.reset(1000);
    for (const txnType of [undefined, '', 'deposit', 'WITHDRAWAL', 'balance ', 5, null, {}]) {
      const r = await ctx.http().post(e.path, body({ txnType, amount: 10 }));
      assert.equal(r.s, 400, `txnType ${JSON.stringify(txnType)}: ${JSON.stringify(r.b)}`); assert.equal(r.b.code, 'INVALID_INPUT');
    }
    assert.equal(await ctx.wallet(), 1000); assert.equal((await ctx.txns()).length, 0);
  });

  test(`${e.label}: Aadhaar must be 12 digits (spaces / dashes allowed, stored masked)`, async () => {
    await ctx.reset(1000);
    for (const txnType of ['balance', 'mini', 'withdrawal']) {
      for (const aadhaar of [undefined, '', '12345678901', '1234567890123', 'ABCDEFGHIJKL', '1234 5678 901', '12345678901 2x', null, 123456789012.5]) {
        const r = await ctx.http().post(e.path, body({ txnType, aadhaar, amount: 10 }));
        assert.equal(r.s, 400, `${txnType} aadhaar ${JSON.stringify(aadhaar)}: ${JSON.stringify(r.b)}`);
      }
    }
    assert.equal(await ctx.wallet(), 1000); assert.equal((await ctx.txns()).length, 0); assert.equal((await ctx.ledger()).length, 0);
    for (const aadhaar of ['2345 1234 1234', '2345-1234-1234', ' 234512341234 ', 234512341234]) {
      const r = await ctx.http().post(e.path, body({ txnType: 'balance', aadhaar }));
      assert.equal(r.s, 201, `${JSON.stringify(aadhaar)}: ${JSON.stringify(r.b)}`); assert.equal(r.b.receipt.target, MASKED);
    }
  });

  test(`${e.label}: balance enquiry and mini statement are free: no debit, no ledger row, a success row with amount 0`, async () => {
    await ctx.reset(1000);
    let r = await ctx.http().post(e.path, body({ txnType: 'balance' }));
    assert.equal(r.s, 201, JSON.stringify(r.b));
    assert.equal(r.b.receipt.title, `${e.name} — Balance Enquiry`); assert.equal(r.b.receipt.target, MASKED); assert.equal(r.b.receipt.operator, 'State Bank of India');
    assert.equal(typeof r.b.receipt.provider.currentBalance, 'number'); assert.ok(r.b.receipt.reference);
    r = await ctx.http().post(e.path, body({ txnType: 'mini', amount: 5000 }));
    assert.equal(r.s, 201, JSON.stringify(r.b));
    assert.equal(r.b.receipt.title, `${e.name} — Mini Statement`); assert.ok(Array.isArray(r.b.receipt.provider.statement) && r.b.receipt.provider.statement.length > 0);
    assert.equal(await ctx.wallet(), 1000, 'a stray amount on a mini statement is ignored');
    assert.equal((await ctx.ledger()).length, 0);
    const t = await ctx.txns();
    assert.equal(t.length, 2);
    for (const x of t) { assert.equal(x.status, 'success'); assert.equal(Number(x.amount), 0); assert.equal(x.service, e.name); assert.equal(x.target, MASKED); }
    await ctx.problems(`${e.label} balance`);
  });
}

test('AEPS balance / mini: blocked by KYC, service switch and permission like any other service (nothing recorded)', async () => {
  for (const txnType of ['balance', 'mini']) {
    await ctx.reset(1000);
    await db('users').where({ id: ctx.userId }).update({ kyc_status: 'pending' });
    let r = await ctx.http().post('/api/aeps/transact', body({ txnType }));
    assert.equal(r.s, 403); assert.equal(r.b.code, 'KYC_REQUIRED');
    await db('users').where({ id: ctx.userId }).update({ kyc_status: 'verified' });
    await ctx.setService('AEPS', { is_active: false });
    try { r = await ctx.http().post('/api/aeps/transact', body({ txnType })); assert.equal(r.s, 403); assert.equal(r.b.code, 'SERVICE_OFF'); } finally { await ctx.setService('AEPS', { is_active: true }); }
    const row = { user_type_id: ctx.typeId, service_id: ctx.svcId.AEPS };
    await db('user_type_services').where(row).del();
    try { r = await ctx.http().post('/api/aeps/transact', body({ txnType })); assert.equal(r.s, 403); assert.equal(r.b.code, 'NO_SERVICE_ACCESS'); } finally { await db('user_type_services').insert(row); }
    assert.equal((await ctx.txns()).length, 0, `${txnType}: nothing recorded`);
  }
});

test('AEPS balance: a repeated Idempotency-Key replays the first answer and records ONE row', async () => {
  await ctx.reset(1000);
  const key = `${ctx.TAG}-aeps-bal`;
  const first = await ctx.http().post('/api/aeps/transact', body({ txnType: 'balance' }), { 'Idempotency-Key': key });
  const second = await postUntilSettled(ctx, '/api/aeps/transact', body({ txnType: 'balance' }), { 'Idempotency-Key': key });
  assert.equal(second.h.get('idempotent-replay'), 'true'); assert.deepEqual(second.b, first.b);
  assert.equal((await ctx.txns()).length, 1);
});

test('AEPS: the full Aadhaar number is never stored in the transaction row, ledger, receipt or audit log', async () => {
  await ctx.reset(1000);
  const bal = await ctx.http().post('/api/aeps/transact', body({ txnType: 'balance' }));
  const wd = await ctx.http().post('/api/aeps/transact', body({ txnType: 'withdrawal', amount: 10 }));
  const everything = JSON.stringify([bal.b, wd.b, await ctx.txns(), await ctx.ledger(), await db('audit_log').where({ user_id: ctx.userId }).select('*')]);
  assert.ok(!everything.includes(AADHAAR), 'the 12-digit Aadhaar leaked into stored data');
});

test('AEPS withdrawal: [BUG] a withdrawal must name the customer bank (no bank = no IIN to route to)', async () => {
  await ctx.reset(1000);
  const r = await ctx.http().post('/api/aeps/transact', body({ txnType: 'withdrawal', amount: 10, bank: undefined }));
  assert.equal(r.s, 400, `accepted with ${r.s}; wallet now ${await ctx.wallet()}, operator stored ${JSON.stringify((await ctx.txns()).map((t) => t.operator))}`);
  await ctx.reset(1000);
});

test('AEPS withdrawal: [BUG] a cash withdrawal of an amount above the per-transaction AEPS cap (Rs 10,000) is refused', { todo: 'owner decision pending (see QA report)' }, async () => {
  await ctx.reset(500000);
  const r = await ctx.http().post('/api/aeps/transact', body({ txnType: 'withdrawal', amount: 400000 }));
  assert.equal(r.s, 400, `accepted ${r.s}: Rs 4,00,000 cash withdrawal on one Aadhaar; wallet now ${await ctx.wallet()}`);
  await ctx.reset(1000);
});

test('AEPS withdrawal [NOTE]: a cash withdrawal DEBITS the retailer wallet (documents current behaviour; real AEPS pays the retailer)', async () => {
  await ctx.reset(1000);
  const r = await ctx.http().post('/api/aeps/transact', body({ txnType: 'withdrawal', amount: 100 }));
  assert.equal(r.s, 201); assert.equal(await ctx.wallet(), 900);
});

test('GET /aeps/devices: lists the biometric devices; auth enforced; not gated by service switch [NOTE]', async () => {
  const r = await ctx.http().get('/api/aeps/devices');
  assert.equal(r.s, 200); assert.ok(Array.isArray(r.b.devices) && r.b.devices.length >= 1 && r.b.devices.every((d) => typeof d === 'string' && d));
  assert.equal((await ctx.http('').get('/api/aeps/devices')).s, 401);
  assert.equal((await ctx.http(signFor(await adminUser())).get('/api/aeps/devices')).s, 403);
  await ctx.setService('AEPS', { is_active: false });
  try { assert.equal((await ctx.http().get('/api/aeps/devices')).s, 200); } finally { await ctx.setService('AEPS', { is_active: true }); }
});

test('AEPS balance: a provider failure records nothing and the wallet is untouched', async () => {
  await ctx.reset(1000);
  const orig = providers.aeps.transact;
  providers.aeps.transact = () => Promise.reject(Object.assign(new Error('bank switch down'), { status: 502, code: 'PROVIDER_DOWN' }));
  try {
    const r = await ctx.http().post('/api/aeps/transact', body({ txnType: 'balance' }));
    assert.equal(r.s, 502); assert.equal(r.b.code, 'PROVIDER_DOWN');
  } finally { providers.aeps.transact = orig; }
  assert.equal((await ctx.txns()).length, 0); assert.equal(await ctx.wallet(), 1000);
  // the failed call freed its idempotency key (a 5xx / 4xx is not stored)
  assert.equal((await ctx.http().post('/api/aeps/transact', body({ txnType: 'balance' }))).s, 201);
});
