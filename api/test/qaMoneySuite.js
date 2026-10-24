'use strict';

// Registers the standard battery of tests for one retailer money endpoint (POST, amount in the body, paid through
// txnPipeline). Used by the qa_retailer_*.test.js files. `getCtx()` returns the qaFixture context (created in before()).
const { test } = require('node:test');
const assert = require('node:assert');
const { db, signFor, adminUser } = require('./helper');
const pipeline = require('../src/services/txnPipeline.service');
const providers = require('../src/services/providers.service');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A repeat of a key that was just answered can briefly see the previous request still "in progress" (the key row is
// saved asynchronously after the response): poll for a few hundred ms before judging.
async function postUntilSettled(ctx, path, body, headers) {
  let r;
  for (let i = 0; i < 10; i += 1) {
    r = await ctx.http().post(path, body, headers);
    if (r.b.code !== 'IDEMPOTENT_IN_PROGRESS') return r;
    await sleep(100);
  }
  return r;
}

/**
 * spec = { label, path, title (Service Master title), serviceName (name stored on rows), receiptTitle, body(amount) -> request body,
 *          target (stored target), operator (stored operator), mode (stored mode, optional), stub: () => [object, methodName] }
 */
function defineMoneySuite(getCtx, spec) {
  const L = spec.label;
  const post = (body, headers) => getCtx().http().post(spec.path, body, headers);
  const untouched = async (ctx, bal, what) => {
    assert.equal(await ctx.wallet(), bal, `${what}: wallet unchanged`);
    assert.equal((await ctx.txns()).length, 0, `${what}: no transaction row`);
    assert.equal((await ctx.ledger()).length, 0, `${what}: no ledger row`);
  };

  test(`${L}: happy path debits the wallet, writes ledger + success row, returns the receipt`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    const r = await post(spec.body(10));
    assert.equal(r.s, 201, JSON.stringify(r.b));
    const rc = r.b.receipt;
    assert.equal(rc.title, spec.receiptTitle || spec.serviceName);
    assert.equal(rc.ok, true); assert.equal(rc.status, 'success'); assert.equal(rc.amount, 10); assert.equal(rc.charge, 0);
    assert.equal(rc.beforeBalance, 1000); assert.equal(rc.balance, 990);
    assert.ok(rc.clientRef && rc.reference, 'client ref + provider reference are returned');
    if (spec.receiptTarget) spec.receiptTarget(rc); else assert.equal(rc.target, spec.target);
    assert.equal(await ctx.wallet(), 990);
    const led = await ctx.ledger();
    assert.equal(led.length, 1, 'exactly one ledger row');
    assert.equal(led[0].type, 'debit'); assert.equal(Number(led[0].amount), 10); assert.equal(led[0].service_name, spec.serviceName);
    assert.equal(Number(led[0].before_balance), 1000); assert.equal(Number(led[0].updated_balance), 990);
    const t = await ctx.txns();
    assert.equal(t.length, 1); assert.equal(t[0].status, 'success'); assert.equal(Number(t[0].amount), 10); assert.equal(Number(t[0].debit_amount), 10);
    assert.equal(t[0].service, spec.serviceName); assert.equal(t[0].target, spec.target); assert.equal(t[0].client_ref, rc.clientRef);
    assert.equal(t[0].reference_id, rc.reference); assert.equal(t[0].stage, null); assert.ok(t[0].finalized_at);
    if (spec.operator !== undefined) assert.equal(t[0].operator, spec.operator);
    if (spec.mode !== undefined) assert.equal(t[0].mode, spec.mode);
    await ctx.problems(`${L} happy`);
  });

  test(`${L}: a 2-decimal amount (10.55) is debited exactly`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    const r = await post(spec.body(10.55));
    assert.equal(r.s, 201, JSON.stringify(r.b));
    assert.equal(await ctx.wallet(), 989.45);
    assert.equal(Number((await ctx.txns())[0].amount), 10.55);
    await ctx.problems(`${L} decimals`);
  });

  test(`${L}: missing / zero / negative / NaN / non-numeric / infinite amounts are refused with 400 and nothing moves`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    const cases = [['missing', undefined], ['null', null], ['empty string', ''], ['zero', 0], ['negative', -5], ['negative string', '-5'], ['text', 'abc'], ['NaN text', 'NaN'], ['infinity text', '1e999'], ['object', {}], ['-Infinity text', '-Infinity']];
    for (const [name, amount] of cases) {
      const body = spec.body(amount); if (amount === undefined) delete body.amount;
      const r = await post(body);
      assert.equal(r.s, 400, `${name}: ${JSON.stringify(r.b)}`);
      assert.ok(r.b.code, `${name}: error code`);
    }
    await untouched(ctx, 1000, 'invalid amounts');
    await ctx.problems(`${L} invalid`);
  });

  test(`${L}: [BUG] an amount with more than 2 decimals is refused (wallet, ledger and transaction row must agree)`, async () => {
    const ctx = getCtx(); const accepted = [];
    for (const amount of [1.005, 10.999, '10.123', 0.004]) {
      await ctx.reset(1000);
      const r = await post(spec.body(amount));
      // utils/money.js isMoneyAmount() exists to refuse these instead of silently rounding.
      if (r.s !== 400) accepted.push(`${amount} -> ${r.s}: wallet ${await ctx.wallet()} (was 1000), ledger ${(await ctx.ledger()).map((l) => l.amount)}, txn row amount ${(await ctx.txns()).map((t) => t.amount)}`);
    }
    await ctx.reset(1000);
    assert.deepEqual(accepted, [], 'amounts with more than 2 decimals must be refused with 400');
  });

  test(`${L}: [BUG] amounts that are not JSON numbers/strings of digits (true, [5], '0x10') are not coerced into a payment`, async () => {
    const ctx = getCtx(); const accepted = [];
    for (const amount of [true, [5], '0x10', ' ']) {
      await ctx.reset(1000);
      const r = await post(spec.body(amount));
      if (r.s !== 400) accepted.push(`${JSON.stringify(amount)} -> ${r.s} ${r.b.code || ''} (wallet now ${await ctx.wallet()})`);
    }
    await ctx.reset(1000);
    assert.deepEqual(accepted, [], 'these amounts must be refused with 400');
  });

  test(`${L}: an absurd amount (1e12, 1e30, 20 digits) is refused (invalid amount or insufficient balance), never a 500`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    for (const amount of [1e12, 1e30, '99999999999999999999', 1e15]) {
      const r = await post(spec.body(amount));
      assert.equal(r.s, 400, `${amount}: ${JSON.stringify(r.b)}`);
      assert.ok(['INVALID_AMOUNT', 'INSUFFICIENT_BALANCE'].includes(r.b.code), `${amount}: ${r.b.code}`);
    }
    await untouched(ctx, 1000, 'absurd amounts');
  });

  test(`${L}: insufficient balance refuses the request and debits nothing (exact balance is enough)`, async () => {
    const ctx = getCtx(); await ctx.reset(5);
    let r = await post(spec.body(10));
    assert.equal(r.s, 400); assert.equal(r.b.code, 'INSUFFICIENT_BALANCE');
    await untouched(ctx, 5, 'insufficient');
    await ctx.reset(9.99);
    r = await post(spec.body(10));
    assert.equal(r.b.code, 'INSUFFICIENT_BALANCE');
    await untouched(ctx, 9.99, 'insufficient by one paisa');
    await ctx.reset(10);
    r = await post(spec.body(10));
    assert.equal(r.s, 201, JSON.stringify(r.b));
    assert.equal(await ctx.wallet(), 0);
    await ctx.problems(`${L} insufficient`);
    // the next one has nothing to take
    r = await post(spec.body(10));
    assert.equal(r.b.code, 'INSUFFICIENT_BALANCE'); assert.equal(await ctx.wallet(), 0);
  });

  test(`${L}: KYC not verified (pending / rejected) is blocked with 403 and nothing is debited`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    for (const kyc of ['pending', 'rejected', 'submitted', '']) {
      await db('users').where({ id: ctx.userId }).update({ kyc_status: kyc });
      const r = await post(spec.body(10));
      assert.equal(r.s, 403, `kyc ${kyc}: ${JSON.stringify(r.b)}`); assert.equal(r.b.code, 'KYC_REQUIRED');
    }
    await db('users').where({ id: ctx.userId }).update({ kyc_status: 'verified' });
    await untouched(ctx, 1000, 'kyc');
  });

  test(`${L}: a service switched off in Service Master is blocked (403 SERVICE_OFF), nothing debited`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    await ctx.setService(spec.title, { is_active: false });
    try {
      const r = await post(spec.body(10));
      assert.equal(r.s, 403, JSON.stringify(r.b)); assert.equal(r.b.code, 'SERVICE_OFF');
    } finally { await ctx.setService(spec.title, { is_active: true }); }
    await untouched(ctx, 1000, 'service off');
    assert.equal((await post(spec.body(10))).s, 201, 'works again once the service is back on');
    await ctx.problems(`${L} service off`);
  });

  test(`${L}: a user whose type has no permission (or a user override block) gets 403 NO_SERVICE_ACCESS`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    const row = { user_type_id: ctx.typeId, service_id: ctx.svcId[spec.title] };
    await db('user_type_services').where(row).del();
    try {
      let r = await post(spec.body(10));
      assert.equal(r.s, 403, JSON.stringify(r.b)); assert.equal(r.b.code, 'NO_SERVICE_ACCESS');
      await untouched(ctx, 1000, 'no permission');
    } finally { await db('user_type_services').insert(row); }
    // type allows, the user is blocked individually
    await db('user_service_overrides').insert({ user_id: ctx.userId, service_id: row.service_id, allowed: false });
    try {
      const r = await post(spec.body(10));
      assert.equal(r.s, 403); assert.equal(r.b.code, 'NO_SERVICE_ACCESS');
      await untouched(ctx, 1000, 'user blocked');
    } finally { await db('user_service_overrides').where({ user_id: ctx.userId, service_id: row.service_id }).del(); }
  });

  test(`${L}: a repeated Idempotency-Key replays the first answer and debits once`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    const key = `${ctx.TAG}-${spec.label.replace(/\W/g, '')}-idem`;
    const first = await post(spec.body(10), { 'Idempotency-Key': key });
    assert.equal(first.s, 201, JSON.stringify(first.b));
    const second = await postUntilSettled(ctx, spec.path, spec.body(10), { 'Idempotency-Key': key });
    assert.equal(second.s, 201, JSON.stringify(second.b));
    assert.equal(second.h.get('idempotent-replay'), 'true');
    assert.deepEqual(second.b, first.b, 'identical answer');
    assert.equal(await ctx.wallet(), 990, 'debited once');
    assert.equal((await ctx.txns()).length, 1); assert.equal((await ctx.ledger()).length, 1);
    // a different key is a new payment
    assert.equal((await post(spec.body(10))).s, 201);
    assert.equal(await ctx.wallet(), 980);
    await ctx.problems(`${L} idempotency`);
  });

  test(`${L}: concurrent requests with the same Idempotency-Key move the money once`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    const key = `${ctx.TAG}-${spec.label.replace(/\W/g, '')}-race`;
    const rs = await Promise.all([1, 2, 3].map(() => post(spec.body(10), { 'Idempotency-Key': key })));
    assert.equal(rs.filter((r) => r.s === 201 && r.h.get('idempotent-replay') !== 'true').length, 1, JSON.stringify(rs.map((r) => [r.s, r.b.code])));
    assert.ok(rs.every((r) => r.s === 201 || r.b.code === 'IDEMPOTENT_IN_PROGRESS'));
    assert.equal(await ctx.wallet(), 990);
    assert.equal((await ctx.txns()).length, 1);
    await ctx.problems(`${L} race`);
  });

  test(`${L}: provider declines (amount 1): 402, failed row, refund in the ledger, wallet whole, key freed for a retry`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    const key = `${ctx.TAG}-${spec.label.replace(/\W/g, '')}-declined`;
    const r = await post(spec.body(1), { 'Idempotency-Key': key });
    assert.equal(r.s, 402, JSON.stringify(r.b)); assert.equal(r.b.code, 'PROVIDER_DECLINED');
    assert.equal(await ctx.wallet(), 1000);
    const t = await ctx.txns();
    assert.equal(t.length, 1); assert.equal(t[0].status, 'failed'); assert.equal(t[0].stage, null); assert.ok(t[0].finalized_at);
    const led = await ctx.ledger();
    assert.deepEqual(led.map((l) => l.type), ['debit', 'credit']);
    assert.match(led[1].remark, /Refund/); assert.equal(Number(led[1].amount), 1);
    await ctx.problems(`${L} declined`);
    // The failure freed the key: the same key runs again (a second failed attempt), it is NOT replayed from the first.
    const again = await postUntilSettled(ctx, spec.path, spec.body(1), { 'Idempotency-Key': key });
    assert.equal(again.s, 402, JSON.stringify(again.b));
    assert.equal(again.h.get('idempotent-replay'), null);
    assert.equal((await ctx.txns()).length, 2);
    assert.equal(await ctx.wallet(), 1000);
    await ctx.problems(`${L} declined retry`);
  });

  test(`${L}: provider answers pending (amount 2): 201 pending, money held, later success keeps the debit; (amount 3) later failure refunds once`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    let r = await post(spec.body(2));
    assert.equal(r.s, 201, JSON.stringify(r.b));
    assert.equal(r.b.receipt.status, 'pending'); assert.equal(r.b.receipt.commission, 0); assert.equal(r.b.receipt.balance, 998);
    assert.equal(await ctx.wallet(), 998);
    let t = await ctx.txns();
    assert.equal(t[0].status, 'pending'); assert.equal(t[0].finalized_at, null);
    assert.equal((await ctx.ledger()).filter((l) => l.type === 'credit').length, 0, 'no refund while pending');
    await ctx.problems(`${L} pending`);
    let f = await pipeline.finalize(t[0].id, 'success', { source: 'admin' });
    assert.equal(f.status, 'success'); assert.equal(await ctx.wallet(), 998, 'success keeps the money debited');
    assert.equal((await pipeline.finalize(t[0].id, 'failed', { source: 'admin' })).changed, false, 'a settled row is not refunded afterwards');
    assert.equal(await ctx.wallet(), 998);

    r = await post(spec.body(3));
    assert.equal(r.b.receipt.status, 'pending'); assert.equal(await ctx.wallet(), 995);
    t = await ctx.txns();
    f = await pipeline.finalize(t[1].id, 'failed', { source: 'status_check' });
    assert.equal(f.status, 'failed'); assert.equal(await ctx.wallet(), 998, 'refunded');
    assert.equal((await pipeline.finalize(t[1].id, 'failed', { source: 'status_check' })).changed, false);
    assert.equal(await ctx.wallet(), 998, 'refunded once');
    await ctx.problems(`${L} pending settled`);
  });

  if (spec.stub) {
    test(`${L}: a provider timeout leaves the transaction pending (stage unknown) with the money held, not refunded`, async () => {
      const ctx = getCtx(); await ctx.reset(1000);
      const [obj, name] = spec.stub();
      const orig = obj[name];
      obj[name] = () => Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' }));
      try {
        const r = await post(spec.body(10));
        assert.equal(r.s, 201, JSON.stringify(r.b)); assert.equal(r.b.receipt.status, 'pending');
      } finally { obj[name] = orig; }
      assert.equal(await ctx.wallet(), 990);
      const t = await ctx.txns();
      assert.equal(t[0].status, 'pending'); assert.equal(t[0].stage, 'unknown');
      assert.equal((await ctx.ledger()).filter((l) => l.type === 'credit').length, 0);
      await ctx.problems(`${L} timeout`);
    });
  }

  test(`${L}: no token is 401, an admin (not a retailer) token is 403, and no money moves`, async () => {
    const ctx = getCtx(); await ctx.reset(1000);
    assert.equal((await ctx.http('').post(spec.path, spec.body(10))).s, 401);
    assert.equal((await ctx.http('garbage').post(spec.path, spec.body(10))).s, 401);
    const adminTok = signFor(await adminUser());
    const r = await ctx.http(adminTok).post(spec.path, spec.body(10));
    assert.equal(r.s, 403); assert.equal(r.b.code, 'FORBIDDEN');
    await untouched(ctx, 1000, 'auth');
  });
}

module.exports = { defineMoneySuite, postUntilSettled, providers, sleep };
