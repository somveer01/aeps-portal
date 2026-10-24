'use strict';

const db = require('../config/db');
const pipeline = require('../services/txnPipeline.service');
const audit = require('../repositories/audit.repo');
const txnAuth = require('../services/txnAuth.service');
const serviceGuard = require('../services/serviceGuard.service');
const providerRouter = require('../services/providerRouter.service');
const N = require('../services/serviceNames');

/*
 * Every provider call goes to the API that API Management picked for the service (and user):
 * money calls get `route` from the pipeline (providerCall(clientRef, route)); look-ups (plans, bill fetch,
 * DMT sender ...) ask the router for the same service so the same API answers both.
 */
const clean = (v) => String(v || '').trim();
const apiFor = async (req, serviceName) => (await providerRouter.resolve({ userId: req.user.id, serviceName })).api;
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const logTxn = (req, service, detail) => audit.log({ userId: req.user.id, username: req.user.username, event: 'service_txn', detail: { service, ...detail }, ...meta(req) });

// ── Recharge ──────────────────────────────────────────────────────
async function rechargePlans(req, res, next) {
  try { return res.json(await (await apiFor(req, N.MOBILE_RECHARGE)).recharge.plans({ operator: clean(req.query.operator), circle: clean(req.query.circle) })); } catch (e) { return next(e); }
}
async function dthInfo(req, res, next) {
  try { return res.json(await (await apiFor(req, N.DTH_RECHARGE)).recharge.dthInfo({ operator: clean(req.query.operator), number: clean(req.query.number) })); } catch (e) { return next(e); }
}
async function rechargeMobile(req, res, next) {
  try {
    const number = clean(req.body.number); const operator = clean(req.body.operator); const amount = Number(req.body.amount);
    if (!/^\d{10}$/.test(number)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number', code: 'INVALID_INPUT' });
    const r = await pipeline.run({ user: req.user, service: N.MOBILE_RECHARGE, operator, target: number, amount, providerCall: (clientRef, route) => route.api.recharge.recharge({ operator, number, amount, clientRef, spKey: route.spKey }) });
    await logTxn(req, N.MOBILE_RECHARGE, { amount, operator });
    return res.status(201).json({ receipt: { title: N.MOBILE_RECHARGE, operator, target: number, ...r } });
  } catch (e) { return next(e); }
}
async function rechargeDth(req, res, next) {
  try {
    const number = clean(req.body.number); const operator = clean(req.body.operator); const amount = Number(req.body.amount);
    if (!number) return res.status(400).json({ error: 'Enter a DTH number', code: 'INVALID_INPUT' });
    const r = await pipeline.run({ user: req.user, service: N.DTH_RECHARGE, operator, target: number, amount, providerCall: (clientRef, route) => route.api.recharge.recharge({ operator, number, amount, clientRef, spKey: route.spKey }) });
    await logTxn(req, N.DTH_RECHARGE, { amount, operator });
    return res.status(201).json({ receipt: { title: N.DTH_RECHARGE, operator, target: number, ...r } });
  } catch (e) { return next(e); }
}

// ── BBPS / LIC / Gas / FASTag (generic bill/pay) ──────────────────
async function bbpsFetch(req, res, next) {
  try { return res.json({ bill: await (await apiFor(req, 'Bill Payment')).bbps.fetchBill({ category: clean(req.body.category), operator: clean(req.body.operator), params: req.body.params || {} }) }); } catch (e) { return next(e); }
}
function makePay(serviceName, { defaultMode = null } = {}) {
  return async function pay(req, res, next) {
    try {
      const operator = clean(req.body.operator); const target = clean(req.body.target || req.body.number || req.body.consumerNo || req.body.policyNo);
      const amount = Number(req.body.amount);
      const mode = defaultMode ? (['IMPS', 'NEFT'].includes(req.body.mode) ? req.body.mode : defaultMode) : null;
      const r = await pipeline.run({ user: req.user, service: serviceName, operator, mode, target, amount, providerCall: (clientRef, route) => route.api.bbps.pay({ amount, operator, mode, target, clientRef, spKey: route.spKey }) });
      await logTxn(req, serviceName, { amount, operator });
      return res.status(201).json({ receipt: { title: serviceName, operator, target, ...r } });
    } catch (e) { return next(e); }
  };
}

// ── AEPS / Aadhar Pay / Micro ATM ─────────────────────────────────
async function aepsDevices(req, res, next) {
  try { return res.json(await (await apiFor(req, 'AEPS')).aeps.devices()); } catch (e) { return next(e); }
}
function makeAeps(serviceName) {
  return async function transact(req, res, next) {
    try {
      const txnType = ['balance', 'withdrawal', 'mini'].includes(req.body.txnType) ? req.body.txnType : null;
      if (!txnType) return res.status(400).json({ error: 'Choose a transaction type', code: 'INVALID_INPUT' });
      const aadhaar = clean(req.body.aadhaar).replace(/\s|-/g, '');
      if (!/^\d{12}$/.test(aadhaar)) return res.status(400).json({ error: 'Enter a valid 12-digit Aadhaar number', code: 'INVALID_INPUT' });
      const bank = clean(req.body.bank); const amount = txnType === 'withdrawal' ? Number(req.body.amount) : 0;
      const maskedAadhaar = `XXXXXXXX${aadhaar.slice(-4)}`;

      // Balance/mini are informational (no wallet debit); withdrawal moves money.
      if (txnType !== 'withdrawal') {
        const svc = await serviceGuard.check({ userId: req.user.id, serviceName });
        const route = await providerRouter.resolve({ userId: req.user.id, serviceName, service: svc, operator: bank });
        const provider = await route.api.aeps.transact({ txnType, deviceType: clean(req.body.deviceType), mobile: clean(req.body.mobile), aadhaar, bank, spKey: route.spKey });
        await db('service_transactions').insert({ user_id: req.user.id, service: serviceName, operator: bank, target: maskedAadhaar, amount: 0, status: 'success', reference_id: provider.rrn, response: JSON.stringify(provider), provider_id: route.providerId, sp_key: route.spKey });
        await logTxn(req, serviceName, { txnType, bank });
        return res.status(201).json({ receipt: { title: `${serviceName} — ${txnType === 'balance' ? 'Balance Enquiry' : 'Mini Statement'}`, operator: bank, target: maskedAadhaar, provider, reference: provider.rrn } });
      }
      const r = await pipeline.run({ user: req.user, service: serviceName, operator: bank, target: maskedAadhaar, amount, providerCall: (clientRef, route) => route.api.aeps.transact({ txnType, deviceType: clean(req.body.deviceType), mobile: clean(req.body.mobile), aadhaar, bank, amount, clientRef, spKey: route.spKey }) });
      await logTxn(req, serviceName, { txnType: 'withdrawal', amount, bank });
      return res.status(201).json({ receipt: { title: `${serviceName} — Cash Withdrawal`, operator: bank, target: maskedAadhaar, ...r } });
    } catch (e) { return next(e); }
  };
}

// ── DMT (money transfer) ──────────────────────────────────────────
async function dmtSender(req, res, next) {
  try {
    const mobile = clean(req.body.mobile);
    if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile', code: 'INVALID_INPUT' });
    let sender = await db('dmt_senders').where({ retailer_id: req.user.id, mobile }).first();
    if (!sender) {
      const info = await (await apiFor(req, N.MONEY_TRANSFER)).dmt.registerSender({ mobile });
      const [row] = await db('dmt_senders').insert({ retailer_id: req.user.id, mobile, name: info.name, kyc_status: info.kycStatus }).returning('*');
      sender = typeof row === 'object' ? row : await db('dmt_senders').where({ retailer_id: req.user.id, mobile }).first();
    }
    return res.json({ sender: { id: sender.id, mobile: sender.mobile, name: sender.name, kycStatus: sender.kyc_status, availableLimit: Number(sender.monthly_limit) - Number(sender.used_limit), usedLimit: Number(sender.used_limit) } });
  } catch (e) { return next(e); }
}
async function dmtBeneficiaries(req, res, next) {
  try {
    const senderId = parseInt(req.query.senderId, 10);
    const sender = await db('dmt_senders').where({ id: senderId, retailer_id: req.user.id }).first();
    if (!sender) return res.status(404).json({ error: 'Sender not found', code: 'NOT_FOUND' });
    const rows = await db('dmt_beneficiaries').where({ sender_id: senderId }).orderBy('id', 'desc');
    return res.json({ rows });
  } catch (e) { return next(e); }
}
async function dmtBeneficiaryAdd(req, res, next) {
  try {
    const senderId = parseInt(req.body.senderId, 10);
    const sender = await db('dmt_senders').where({ id: senderId, retailer_id: req.user.id }).first();
    if (!sender) return res.status(404).json({ error: 'Sender not found', code: 'NOT_FOUND' });
    const name = clean(req.body.name); const bank = clean(req.body.bankName); const acct = clean(req.body.accountNo); const ifsc = clean(req.body.ifsc).toUpperCase();
    if (name.length < 2 || !/^\d{6,20}$/.test(acct) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return res.status(400).json({ error: 'Enter valid beneficiary details', code: 'INVALID_INPUT' });
    const [row] = await db('dmt_beneficiaries').insert({ sender_id: senderId, name, bank_name: bank, account_no: acct, ifsc, verified: false }).returning('*');
    return res.status(201).json({ row: typeof row === 'object' ? row : { id: row } });
  } catch (e) { return next(e); }
}
async function dmtBeneficiaryVerify(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const b = await db('dmt_beneficiaries as bn').join('dmt_senders as s', 's.id', 'bn.sender_id').where('bn.id', id).andWhere('s.retailer_id', req.user.id).first('bn.*');
    if (!b) return res.status(404).json({ error: 'Beneficiary not found', code: 'NOT_FOUND' });
    const v = await (await apiFor(req, N.MONEY_TRANSFER)).dmt.verifyBeneficiary({ name: b.name, accountNo: b.account_no, ifsc: b.ifsc });
    await db('dmt_beneficiaries').where({ id }).update({ verified: true, name: v.name || b.name });
    return res.json({ verified: true, name: v.name || b.name });
  } catch (e) { return next(e); }
}
async function dmtTransfer(req, res, next) {
  try {
    const id = parseInt(req.body.beneficiaryId, 10); const amount = Number(req.body.amount);
    const mode = ['IMPS', 'NEFT'].includes(req.body.mode) ? req.body.mode : 'IMPS';
    const b = await db('dmt_beneficiaries as bn').join('dmt_senders as s', 's.id', 'bn.sender_id')
      .where('bn.id', id).andWhere('s.retailer_id', req.user.id).first('bn.*', 's.id as sender_id');
    if (!b) return res.status(404).json({ error: 'Beneficiary not found', code: 'NOT_FOUND' });
    if (!b.verified) return res.status(400).json({ error: 'Verify the beneficiary first', code: 'NOT_VERIFIED' });
    const okPin = await txnAuth.verify(req.user.id, req.body.txnPin);
    if (!okPin) return res.status(401).json({ error: 'Invalid transaction PIN/password', code: 'BAD_TXN_PASSWORD' });

    const r = await pipeline.run({ user: req.user, service: N.MONEY_TRANSFER, operator: `${b.bank_name} (${mode})`, mode, target: b.account_no, amount, providerCall: (clientRef, route) => route.api.dmt.transfer({ amount, mode, beneficiary: b, clientRef, spKey: route.spKey }) });
    await db('dmt_senders').where({ id: b.sender_id }).increment('used_limit', amount);
    await logTxn(req, N.MONEY_TRANSFER, { amount, mode, beneficiaryId: id });
    return res.status(201).json({ receipt: { title: N.MONEY_TRANSFER, operator: b.bank_name, target: b.account_no, mode, ...r } });
  } catch (e) { return next(e); }
}

// ── Bookings (flight/hotel/bus) ───────────────────────────────────
async function bookingSearch(req, res, next) {
  try {
    const type = ['flight', 'hotel', 'bus'].includes(req.params.type) ? req.params.type : null;
    if (!type) return res.status(400).json({ error: 'Invalid booking type', code: 'INVALID_INPUT' });
    return res.json(await (await apiFor(req, N.BOOKING[type])).booking.search(type, req.query));
  } catch (e) { return next(e); }
}
async function bookingBook(req, res, next) {
  try {
    const type = ['flight', 'hotel', 'bus'].includes(req.params.type) ? req.params.type : null;
    if (!type) return res.status(400).json({ error: 'Invalid booking type', code: 'INVALID_INPUT' });
    const amount = Number(req.body.amount); const pax = req.body.pax || {};
    const r = await pipeline.run({ user: req.user, service: N.BOOKING[type], target: clean(req.body.offerId), amount, providerCall: (clientRef, route) => route.api.booking.book({ type, offerId: req.body.offerId, pax, amount, clientRef, spKey: route.spKey }) });
    await db('bookings').insert({ retailer_id: req.user.id, type, pnr: r.provider.pnr, pax: JSON.stringify(pax), amount, status: 'booked', provider_ref: r.reference, detail: JSON.stringify(req.body) });
    await logTxn(req, `${type} booking`, { amount });
    return res.status(201).json({ receipt: { title: N.BOOKING[type], target: r.provider.pnr, ...r } });
  } catch (e) { return next(e); }
}

module.exports = {
  rechargePlans, dthInfo, rechargeMobile, rechargeDth,
  bbpsFetch, payBill: makePay(N.BILL_PAYMENT), payLic: makePay(N.LIC_PAYMENT), payGas: makePay(N.GAS_BOOKING), rechargeFastag: makePay(N.FASTAG), moveToBank: makePay(N.MOVE_TO_BANK, { defaultMode: 'IMPS' }),
  aepsDevices, aepsTransact: makeAeps(N.AEPS), aadharPay: makeAeps(N.AADHAR_PAY), microAtm: makeAeps(N.MICRO_ATM),
  dmtSender, dmtBeneficiaries, dmtBeneficiaryAdd, dmtBeneficiaryVerify, dmtTransfer,
  bookingSearch, bookingBook,
};
