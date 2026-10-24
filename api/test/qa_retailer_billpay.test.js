'use strict';

// QA: retailer bill-pay style money endpoints no other test calls over HTTP - DTH recharge, BBPS (fetch-bill + pay), LIC,
// gas, FASTag, move-to-bank - plus the look-ups (operators, plans, DTH info). Throwaway type / user / wallet, mock provider.
// Run: PGDATABASE=fintech_qa_a node --test --test-concurrency=1 test/qa_retailer_billpay.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, signFor, adminUser } = require('./helper');
const fixture = require('./qaFixture');
const { defineMoneySuite, providers } = require('./qaMoneySuite');

let ctx;
before(async () => { ctx = await fixture.create({ prefix: 'qb', port: 3880 }); });
after(async () => { await ctx.cleanup(); });
const get = () => ctx;

// ── the standard battery for every endpoint ──
defineMoneySuite(get, { label: 'POST /recharge/dth', path: '/api/recharge/dth', title: 'DTH Recharge', serviceName: 'DTH Recharge', target: '1234567890', operator: 'Tata Play', stub: () => [providers.recharge, 'recharge'], body: (amount) => ({ number: '1234567890', operator: 'Tata Play', amount }) });
defineMoneySuite(get, { label: 'POST /bbps/pay', path: '/api/bbps/pay', title: 'Bill Payment', serviceName: 'Bill Payment', target: 'CA12345678', operator: 'MSEDCL', stub: () => [providers.bbps, 'pay'], body: (amount) => ({ operator: 'MSEDCL', target: 'CA12345678', amount }) });
defineMoneySuite(get, { label: 'POST /lic/pay', path: '/api/lic/pay', title: 'LIC Payment', serviceName: 'LIC Payment', target: 'POL998877', operator: 'LIC', stub: () => [providers.bbps, 'pay'], body: (amount) => ({ operator: 'LIC', policyNo: 'POL998877', amount }) });
defineMoneySuite(get, { label: 'POST /gas/pay', path: '/api/gas/pay', title: 'Gas Booking', serviceName: 'Gas Booking', target: 'GAS556677', operator: 'HP Gas', stub: () => [providers.bbps, 'pay'], body: (amount) => ({ operator: 'HP Gas', consumerNo: 'GAS556677', amount }) });
defineMoneySuite(get, { label: 'POST /fastag/recharge', path: '/api/fastag/recharge', title: 'Fastag Recharge', serviceName: 'Fastag Recharge', target: 'DL1CAB1234', operator: 'ICICI FASTag', stub: () => [providers.bbps, 'pay'], body: (amount) => ({ operator: 'ICICI FASTag', number: 'DL1CAB1234', amount }) });
defineMoneySuite(get, { label: 'POST /move-to-bank', path: '/api/move-to-bank', title: 'Move To Bank', serviceName: 'Move To Bank', target: '123456789012', operator: 'HDFC Bank', mode: 'IMPS', stub: () => [providers.bbps, 'pay'], body: (amount) => ({ operator: 'HDFC Bank', target: '123456789012', amount }) });

// ── missing identifiers: money must not be taken for a payment that names no number / account ──
const noTarget = [
  ['POST /recharge/dth', '/api/recharge/dth', { operator: 'Tata Play', amount: 10 }, 'DTH number'],
  ['POST /bbps/pay', '/api/bbps/pay', { operator: 'MSEDCL', amount: 10 }, 'consumer number'],
  ['POST /lic/pay', '/api/lic/pay', { operator: 'LIC', amount: 10 }, 'policy number'],
  ['POST /gas/pay', '/api/gas/pay', { operator: 'HP Gas', amount: 10 }, 'consumer number'],
  ['POST /fastag/recharge', '/api/fastag/recharge', { operator: 'ICICI FASTag', amount: 10 }, 'vehicle number'],
  ['POST /move-to-bank', '/api/move-to-bank', { operator: 'HDFC Bank', amount: 10 }, 'bank account'],
];
for (const [label, path, body, what] of noTarget) {
  const isDth = path.endsWith('/dth');
  test(`${label}: ${isDth ? '' : '[BUG] '}a payment with no ${what} is refused with 400 and nothing is debited`, async () => {
    await ctx.reset(1000);
    const r = await ctx.http().post(path, body);
    assert.equal(r.s, 400, `accepted with ${r.s}; wallet now ${await ctx.wallet()}; target stored: ${JSON.stringify((await ctx.txns()).map((t) => t.target))}`);
    assert.equal(await ctx.wallet(), 1000);
    assert.equal((await ctx.txns()).length, 0);
    await ctx.reset(1000);
  });
}

test('POST /bbps/pay + friends: [BUG] a payment with no operator at all is refused', async () => {
  await ctx.reset(1000);
  const r = await ctx.http().post('/api/bbps/pay', { target: 'CA1', amount: 10 });
  assert.equal(r.s, 400, `accepted with ${r.s}, wallet ${await ctx.wallet()}`);
  await ctx.reset(1000);
});

test('POST /move-to-bank: [BUG] the account number must be digits (letters / empty-ish values are refused)', async () => {
  for (const target of ['ABCDEF', '12', '12 34 56 78 90', '<script>']) {
    await ctx.reset(1000);
    const r = await ctx.http().post('/api/move-to-bank', { operator: 'HDFC Bank', target, amount: 10 });
    assert.equal(r.s, 400, `target ${JSON.stringify(target)} accepted (${r.s})`);
  }
  await ctx.reset(1000);
});

test('POST /move-to-bank: mode NEFT is stored, IMPS is the default, and an unknown mode is refused', async () => {
  await ctx.reset(1000);
  let r = await ctx.http().post('/api/move-to-bank', { operator: 'HDFC Bank', target: '123456789012', amount: 10, mode: 'NEFT' });
  assert.equal(r.s, 201); assert.equal(r.b.receipt.title, 'Move To Bank');
  r = await ctx.http().post('/api/move-to-bank', { operator: 'HDFC Bank', target: '123456789012', amount: 10 });
  assert.equal(r.s, 201);
  r = await ctx.http().post('/api/move-to-bank', { operator: 'HDFC Bank', target: '123456789012', amount: 10, mode: 'RTGS' });
  const t = await ctx.txns();
  assert.deepEqual(t.slice(0, 2).map((x) => x.mode), ['NEFT', 'IMPS']);
  // RTGS is not offered: refused, nothing debited or recorded
  assert.equal(r.s, 400); assert.equal(r.b.code, 'INVALID_MODE'); assert.equal(t.length, 2);
  await ctx.problems('move-to-bank modes');
});

// ── service charge (debit slab) ──
test('service charge: a debit slab adds amount + charge + GST to the debit; ledger, receipt and row agree; refund returns both', async () => {
  const [plan] = await db('plans').insert({ user_type_id: ctx.typeId, name: `${ctx.TAG} plan` }).returning('id');
  await db('commission_slots').insert({ user_type_id: ctx.typeId, service_id: ctx.svcId['Bill Payment'], plan_id: typeof plan === 'object' ? plan.id : plan, commission_type: 'percentage', value: 2, min_amount: 1, max_amount: 100000, chain_type: 'self', txn_type: 'debit', is_active: true });
  const pay = (amount) => ctx.http().post('/api/bbps/pay', { operator: 'MSEDCL', target: 'CA12345678', amount });
  await ctx.reset(1000);
  let r = await pay(100);
  assert.equal(r.s, 201, JSON.stringify(r.b));
  assert.equal(r.b.receipt.amount, 100); assert.equal(r.b.receipt.charge, 2.36); assert.equal(r.b.receipt.balance, 897.64);
  assert.equal(await ctx.wallet(), 897.64);
  let led = await ctx.ledger();
  assert.deepEqual(led.map((l) => [l.type, Number(l.amount), l.service_name]), [['debit', 100, 'Bill Payment'], ['debit', 2.36, 'Bill Payment Charge']]);
  let t = await ctx.txns();
  assert.equal(Number(t[0].debit_amount), 102.36); assert.equal(Number(t[0].service_charge), 2.36); assert.equal(Number(t[0].amount), 100);
  assert.equal((await db('commission_ledger').where({ user_id: ctx.userId })).length, 1, 'the charge is recorded in the commission ledger');
  await ctx.problems('service charge');

  // not enough for amount + charge: refused, nothing taken
  await ctx.reset(101);
  r = await pay(100);
  assert.equal(r.s, 400); assert.equal(r.b.code, 'INSUFFICIENT_BALANCE'); assert.match(r.b.error, /service charge/i);
  assert.equal(await ctx.wallet(), 101); assert.equal((await ctx.ledger()).length, 0);

  // declined: the charge comes back too
  await ctx.reset(1000);
  r = await pay(1);
  assert.equal(r.s, 402); assert.equal(await ctx.wallet(), 1000);
  t = await ctx.txns(); assert.equal(t[0].status, 'failed');
  await ctx.problems('service charge declined');

  // pending then failed: full refund (amount + charge) exactly once
  await ctx.reset(1000);
  r = await pay(3);
  assert.equal(r.b.receipt.status, 'pending'); assert.equal(await ctx.wallet(), 1000 - 3 - 0.07);
  t = await ctx.txns();
  await require('../src/services/txnPipeline.service').finalize(t[0].id, 'failed', { source: 'admin' });
  assert.equal(await ctx.wallet(), 1000);
  await ctx.problems('service charge pending failed');

  // pending then success: charge stays, the commission-ledger charge row exists
  await ctx.reset(1000);
  r = await pay(2);
  t = await ctx.txns();
  await require('../src/services/txnPipeline.service').finalize(t[0].id, 'success', { source: 'admin' });
  assert.equal(await ctx.wallet(), 1000 - 2 - 0.05);
  assert.equal((await db('commission_ledger').where({ user_id: ctx.userId })).length, 1);
  await ctx.problems('service charge pending success');
  await db('commission_slots').where({ user_type_id: ctx.typeId }).del();
});

// ── BBPS fetch-bill ──
test('POST /bbps/fetch-bill: returns the bill; auth is enforced', async () => {
  const r = await ctx.http().post('/api/bbps/fetch-bill', { category: 'Electricity', operator: 'MSEDCL', params: { consumerNo: '123456' } });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.equal(r.b.bill.operator, 'MSEDCL'); assert.equal(typeof r.b.bill.amount, 'number'); assert.ok(r.b.bill.billNumber && r.b.bill.dueDate);
  assert.equal((await ctx.http('').post('/api/bbps/fetch-bill', {})).s, 401);
  assert.equal((await ctx.http(signFor(await adminUser())).post('/api/bbps/fetch-bill', {})).s, 403);
});

test('POST /bbps/fetch-bill: [BUG] a look-up with no operator / no consumer details is refused with 400', async () => {
  const r = await ctx.http().post('/api/bbps/fetch-bill', {});
  assert.equal(r.s, 400, `answered ${r.s}: ${JSON.stringify(r.b)}`);
  const r2 = await ctx.http().post('/api/bbps/fetch-bill', { category: 'Electricity', operator: 'MSEDCL', params: 'not-an-object' });
  assert.equal(r2.s, 400, `params as a string answered ${r2.s}`);
});

test('POST /bbps/fetch-bill never moves money [no wallet / ledger change]', async () => {
  await ctx.reset(1000);
  await ctx.http().post('/api/bbps/fetch-bill', { category: 'Electricity', operator: 'MSEDCL', params: { consumerNo: '1' } });
  assert.equal(await ctx.wallet(), 1000); assert.equal((await ctx.txns()).length, 0);
});

test('POST /bbps/pay: [BUG] a bill payment is not tied to the fetched bill - any amount is accepted for a fetched bill of another value', { todo: 'owner decision pending (see QA report)' }, async () => {
  // fetch-bill returns amount 1548; pay has no billNumber / bill amount check, so ANY amount (here 7) is taken and sent.
  await ctx.reset(1000);
  const bill = (await ctx.http().post('/api/bbps/fetch-bill', { category: 'Electricity', operator: 'MSEDCL', params: { consumerNo: '1' } })).b.bill;
  const r = await ctx.http().post('/api/bbps/pay', { operator: 'MSEDCL', target: '1', amount: 7, billNumber: bill.billNumber });
  assert.notEqual(r.s, 201, `paid 7 against a fetched bill of ${bill.amount} (billNumber ${bill.billNumber}) and got ${r.s}`);
  await ctx.reset(1000);
});

// ── look-ups ──
test('GET /operators: lists active operators, filters by service / category, hides a switched-off one', async () => {
  const all = await ctx.http().get('/api/operators');
  assert.equal(all.s, 200); assert.ok(all.b.rows.length >= 20);
  assert.deepEqual(Object.keys(all.b.rows[0]).sort(), ['category', 'circle_required', 'id', 'name', 'service']);
  const mobile = await ctx.http().get('/api/operators?service=mobile');
  assert.ok(mobile.b.rows.length >= 1 && mobile.b.rows.every((o) => o.service === 'mobile'));
  const dth = await ctx.http().get('/api/operators?service=dth&category=DTH');
  assert.ok(dth.b.rows.length >= 1 && dth.b.rows.every((o) => o.service === 'dth' && o.category === 'DTH'));
  assert.deepEqual((await ctx.http().get('/api/operators?service=nope')).b.rows, []);
  assert.deepEqual((await ctx.http().get('/api/operators?service=mobile&category=Electricity')).b.rows, []);
  assert.deepEqual((await ctx.http().get(`/api/operators?service=${encodeURIComponent("x' or '1'='1")}`)).b.rows, [], 'no injection');
  const one = mobile.b.rows[0];
  await db('operators').where({ id: one.id }).update({ is_active: false });
  try {
    assert.ok(!(await ctx.http().get('/api/operators?service=mobile')).b.rows.some((o) => o.id === one.id), 'a switched-off operator disappears');
  } finally { await db('operators').where({ id: one.id }).update({ is_active: true }); }
  assert.equal((await ctx.http('').get('/api/operators')).s, 401);
  assert.equal((await ctx.http(signFor(await adminUser())).get('/api/operators')).s, 403);
});

test('GET /operators: [NOTE] repeated ?service=a&service=b is treated as one comma-joined string, not a 500', async () => {
  const r = await ctx.http().get('/api/operators?service=mobile&service=dth');
  assert.equal(r.s, 200); assert.deepEqual(r.b.rows, []);
});

test('GET /recharge/plans and /recharge/dth-info: shapes and auth', async () => {
  const p = await ctx.http().get('/api/recharge/plans?operator=Airtel&circle=Delhi');
  assert.equal(p.s, 200); assert.ok(Array.isArray(p.b.tabs) && p.b.tabs.length > 0);
  for (const tab of p.b.tabs) { assert.ok(tab.key); for (const pl of tab.plans) { assert.equal(typeof pl.price, 'number'); assert.ok(pl.price > 0 && pl.desc); } }
  const d = await ctx.http().get('/api/recharge/dth-info?operator=Tata%20Play&number=1234567890');
  assert.equal(d.s, 200); assert.equal(typeof d.b.currentBalance, 'number'); assert.ok(d.b.name && d.b.status && d.b.planName);
  for (const path of ['/api/recharge/plans', '/api/recharge/dth-info']) {
    assert.equal((await ctx.http('').get(path)).s, 401, path);
    assert.equal((await ctx.http(signFor(await adminUser())).get(path)).s, 403, path);
  }
});

test('GET /recharge/dth-info: [BUG] a look-up without a DTH number is refused with 400', async () => {
  const r = await ctx.http().get('/api/recharge/dth-info?operator=Tata%20Play');
  assert.equal(r.s, 400, `answered ${r.s} (returned another person's DTH account details for an empty number)`);
});

test('look-ups (plans, dth-info, fetch-bill) still answer when the service is switched off or KYC is pending [NOTE: not gated]', async () => {
  await ctx.reset(1000);
  await ctx.setService('Mobile Recharge', { is_active: false });
  await ctx.setService('DTH Recharge', { is_active: false });
  await ctx.setService('Bill Payment', { is_active: false });
  await db('users').where({ id: ctx.userId }).update({ kyc_status: 'pending' });
  try {
    assert.equal((await ctx.http().get('/api/recharge/plans')).s, 200);
    assert.equal((await ctx.http().get('/api/recharge/dth-info?number=ABCD1234&operator=Tata%20Play')).s, 200);
    assert.equal((await ctx.http().post('/api/bbps/fetch-bill', { operator: 'MSEDCL', params: {} })).s, 200);
  } finally {
    for (const t of ['Mobile Recharge', 'DTH Recharge', 'Bill Payment']) await ctx.setService(t, { is_active: true });
    await db('users').where({ id: ctx.userId }).update({ kyc_status: 'verified' });
  }
});

test('bill-pay endpoints: [BUG] an over-long number / operator is a 4xx, not a database-error 500', async () => {
  await ctx.reset(1000);
  const bad = [];
  for (const [path, k] of [['/api/recharge/dth', 'number'], ['/api/bbps/pay', 'target'], ['/api/lic/pay', 'policyNo'], ['/api/gas/pay', 'consumerNo'], ['/api/fastag/recharge', 'number'], ['/api/move-to-bank', 'target']]) {
    for (const body of [{ [k]: '9'.repeat(300), operator: 'Op', amount: 10 }, { [k]: '123456', operator: 'O'.repeat(300), amount: 10 }]) {
      const r = await ctx.http().post(path, body);
      if (r.s >= 500) bad.push(`${path} ${body.operator.length}-char operator / ${String(body[k]).length}-char number -> ${r.s}`);
    }
  }
  assert.equal(await ctx.wallet(), 1000, 'nothing debited');
  assert.deepEqual(bad, []);
});
