'use strict';

// QA: flight / hotel / bus search + book over HTTP, on the mock provider with a throwaway type / user / wallet.
// Run: PGDATABASE=fintech_qa_a node --test --test-concurrency=1 test/qa_retailer_booking.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, signFor, adminUser } = require('./helper');
const fixture = require('./qaFixture');
const { defineMoneySuite, postUntilSettled, providers } = require('./qaMoneySuite');
const pipeline = require('../src/services/txnPipeline.service');

let ctx;
before(async () => { ctx = await fixture.create({ prefix: 'qk', port: 3883 }); });
after(async () => { await ctx.cleanup(); });
const get = () => ctx;
const http = (tok) => ctx.http(tok);

const TYPES = [
  { type: 'flight', title: 'Flight Booking', offerId: 'F1' },
  { type: 'hotel', title: 'Hotel Booking', offerId: 'H1' },
  { type: 'bus', title: 'Bus Booking', offerId: 'B1' },
];
const PAX = { name: 'Asha Verma', count: 1 };
const bookBody = (t, amount, extra = {}) => ({ offerId: t.offerId, pax: PAX, amount, ...extra });
const bookings = () => db('bookings').where({ retailer_id: ctx.userId }).orderBy('id');

for (const t of TYPES) {
  defineMoneySuite(get, {
    label: `POST /booking/${t.type}/book`, path: `/api/booking/${t.type}/book`, title: t.title, serviceName: t.title, target: t.offerId, operator: null,
    receiptTarget: (rc) => assert.match(rc.target, /^PNR/, 'the receipt target is the PNR'),
    stub: () => [providers.booking, 'book'], body: (amount) => bookBody(t, amount),
  });
}

for (const t of TYPES) {
  test(`GET /booking/${t.type}/search: returns priced results; auth enforced`, async () => {
    const r = await http().get(`/api/booking/${t.type}/search?from=DEL&to=BOM&date=2026-12-01`);
    assert.equal(r.s, 200, JSON.stringify(r.b));
    assert.ok(Array.isArray(r.b.results) && r.b.results.length >= 1);
    for (const x of r.b.results) { assert.ok(x.id); assert.equal(typeof x.price, 'number'); assert.ok(x.price > 0); }
    assert.equal((await http('').get(`/api/booking/${t.type}/search`)).s, 401);
    assert.equal((await http(signFor(await adminUser())).get(`/api/booking/${t.type}/search`)).s, 403);
  });

  test(`POST /booking/${t.type}/book: success writes a booking row that matches the receipt and the transaction`, async () => {
    await ctx.reset(10000);
    const r = await http().post(`/api/booking/${t.type}/book`, bookBody(t, 250));
    assert.equal(r.s, 201, JSON.stringify(r.b));
    assert.equal(r.b.receipt.title, t.title); assert.equal(r.b.receipt.status, 'success'); assert.equal(r.b.receipt.provider.status, 'booked');
    const rows = await bookings();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, t.type); assert.equal(rows[0].pnr, r.b.receipt.target); assert.equal(Number(rows[0].amount), 250);
    assert.equal(rows[0].status, 'booked'); assert.equal(rows[0].provider_ref, r.b.receipt.reference); assert.deepEqual(rows[0].pax, PAX);
    assert.equal(await ctx.wallet(), 9750);
    await ctx.problems(`${t.type} booking`);
  });

  test(`POST /booking/${t.type}/book: a declined booking leaves no booking row; a repeated key makes ONE booking`, async () => {
    await ctx.reset(1000);
    assert.equal((await http().post(`/api/booking/${t.type}/book`, bookBody(t, 1))).s, 402);
    assert.equal((await bookings()).length, 0);
    const key = `${ctx.TAG}-bk-${t.type}`;
    const a = await http().post(`/api/booking/${t.type}/book`, bookBody(t, 10), { 'Idempotency-Key': key });
    const b = await postUntilSettled(ctx, `/api/booking/${t.type}/book`, bookBody(t, 10), { 'Idempotency-Key': key });
    assert.equal(b.h.get('idempotent-replay'), 'true'); assert.deepEqual(b.b, a.b);
    assert.equal((await bookings()).length, 1); assert.equal(await ctx.wallet(), 990);
    await ctx.problems(`${t.type} idem`);
  });

  test(`POST /booking/${t.type}/book: [BUG] a PENDING payment must not be recorded as a confirmed ('booked') booking, nor stay booked after the refund`, async () => {
    await ctx.reset(1000);
    const r = await http().post(`/api/booking/${t.type}/book`, bookBody(t, 3));
    assert.equal(r.b.receipt.status, 'pending');
    let rows = await bookings();
    assert.equal(rows.length, 1);
    const bad = [];
    if (rows[0].status === 'booked') bad.push('booking is "booked" while the payment is only pending');
    // the payment later fails and is refunded
    await pipeline.finalize((await ctx.txns())[0].id, 'failed', { source: 'status_check' });
    assert.equal(await ctx.wallet(), 1000, 'refunded');
    rows = await bookings();
    if (rows.some((x) => x.status === 'booked')) bad.push('after the refund the booking row is still "booked"');
    assert.deepEqual(bad, []);
  });
}

test('POST /booking/:type/book: [BUG] a provider timeout (outcome unknown) is not recorded as a confirmed booking with an empty PNR', async () => {
  await ctx.reset(1000);
  const orig = providers.booking.book;
  providers.booking.book = () => Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' }));
  let r;
  try { r = await http().post('/api/booking/flight/book', bookBody(TYPES[0], 10)); } finally { providers.booking.book = orig; }
  assert.equal(r.s, 201); assert.equal(r.b.receipt.status, 'pending'); assert.equal(await ctx.wallet(), 990);
  const rows = await bookings();
  assert.ok(rows.length === 0 || (rows[0].status !== 'booked' && rows[0].pnr), `booking row: ${JSON.stringify(rows.map((x) => ({ status: x.status, pnr: x.pnr })))}`);
  await ctx.problems('booking timeout');
});

test('POST /booking/:type/book: unknown booking type is 400 before any money moves', async () => {
  await ctx.reset(1000);
  for (const type of ['train', 'FLIGHT', 'cab', '%20', 'flight%20']) {
    const r = await http().post(`/api/booking/${type}/book`, bookBody(TYPES[0], 10));
    assert.equal(r.s, 400, `${type}: ${r.s} ${JSON.stringify(r.b)}`); assert.equal(r.b.code, 'INVALID_INPUT');
    assert.equal((await http().get(`/api/booking/${type}/search`)).s, 400, `search ${type}`);
  }
  assert.equal(await ctx.wallet(), 1000); assert.equal((await ctx.txns()).length, 0);
});

test('POST /booking/:type/book: the three booking services are switched / permitted independently', async () => {
  await ctx.reset(10000);
  await ctx.setService('Flight Booking', { is_active: false });
  const row = { user_type_id: ctx.typeId, service_id: ctx.svcId['Bus Booking'] };
  await db('user_type_services').where(row).del();
  try {
    const f = await http().post('/api/booking/flight/book', bookBody(TYPES[0], 10));
    assert.equal(f.s, 403); assert.equal(f.b.code, 'SERVICE_OFF');
    const b = await http().post('/api/booking/bus/book', bookBody(TYPES[2], 10));
    assert.equal(b.s, 403); assert.equal(b.b.code, 'NO_SERVICE_ACCESS');
    const h = await http().post('/api/booking/hotel/book', bookBody(TYPES[1], 10));
    assert.equal(h.s, 201, JSON.stringify(h.b));
  } finally { await ctx.setService('Flight Booking', { is_active: true }); await db('user_type_services').insert(row); }
  assert.equal(await ctx.wallet(), 9990); assert.equal((await bookings()).length, 1);
  await ctx.problems('booking independence');
});

test('POST /booking/:type/book: [BUG] a booking without an offerId is refused', async () => {
  await ctx.reset(1000);
  const r = await http().post('/api/booking/flight/book', { pax: PAX, amount: 10 });
  const rows = await bookings(); const w = await ctx.wallet();
  assert.equal(r.s, 400, `accepted with ${r.s}: wallet ${w}, bookings ${rows.length}, txn target ${JSON.stringify((await ctx.txns()).map((x) => x.target))}`);
});

test('POST /booking/:type/book: [BUG] a booking without passenger details (pax) is refused', async () => {
  await ctx.reset(1000);
  const bad = [];
  for (const pax of [undefined, null, 'abc', [], {}]) {
    const r = await http().post('/api/booking/flight/book', { offerId: 'F1', pax, amount: 10 });
    if (r.s === 201) bad.push(`pax ${JSON.stringify(pax)} accepted`);
  }
  await ctx.reset(1000);
  assert.deepEqual(bad, []);
});

test('POST /booking/:type/book: [BUG] the price is the provider\'s offer price, not whatever amount the client sends', async () => {
  // search says F1 costs 4120; the client books it for Rs 5.
  await ctx.reset(10000);
  const offer = (await http().get('/api/booking/flight/search')).b.results.find((x) => x.id === 'F1');
  const r = await http().post('/api/booking/flight/book', { offerId: 'F1', pax: PAX, amount: 5 });
  const rows = await bookings();
  assert.notEqual(r.s, 201, `flight F1 (price ${offer.price}) was booked for Rs ${rows.length ? rows[0].amount : '?'}: wallet now ${await ctx.wallet()}`);
  await ctx.reset(1000);
});

test('POST /booking/:type/book: [BUG] an offerId the search never returned is refused', async () => {
  await ctx.reset(10000);
  const r = await http().post('/api/booking/hotel/book', { offerId: 'DOES-NOT-EXIST', pax: PAX, amount: 500 });
  const w = await ctx.wallet();
  assert.notEqual(r.s, 201, `a hotel booking for a non-existent offer was confirmed (wallet ${w})`);
  await ctx.reset(1000);
});

test('POST /booking/:type/book: [BUG] oversize / odd offerId and pax values never cause a 500 (offerId 200 chars, 100 KB pax)', async () => {
  await ctx.reset(100000);
  const long = await http().post('/api/booking/bus/book', { offerId: 'X'.repeat(200), pax: PAX, amount: 10 });
  assert.ok(long.s < 500, `200-char offerId -> ${long.s} ${JSON.stringify(long.b).slice(0, 200)}`);
  const big = await http().post('/api/booking/bus/book', { offerId: 'B1', pax: { notes: 'y'.repeat(100000) }, amount: 10 });
  assert.ok(big.s < 500, `100KB pax -> ${big.s}`);
  await ctx.problems('booking oversize');
});
