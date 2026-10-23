'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const commission = require('./commission.service');
const serviceGuard = require('./serviceGuard.service');
const providerRouter = require('./providerRouter.service');
const wallet = require('./wallet.service');
const { round2 } = require('../utils/money');

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
// Our own unique id for each attempt; sent to the provider and used by callbacks.
const newClientRef = () => `TX${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * A provider error is a DEFINITE refusal - safe to refund - when the adapter says so (`err.definite`) or when it is a 4xx
 * refusal. Anything else (a timeout, a network error, a 5xx, an unknown answer) may have gone through at the provider, so
 * the transaction stays PENDING and the status check / callback / reconciliation settles it - never failed + refunded
 * on a guess, or the user could get the service and the refund.
 */
const isDefiniteFailure = (e) => !!e && (e.definite === true || (Number.isInteger(e.status) && e.status >= 400 && e.status < 500));

/**
 * The single money pipeline used by every paid retailer service. Three short steps, so no wallet lock is held while the
 * (slow) provider answers, and every attempt is on record even if the server dies half way:
 *
 *   A. (transaction 1) lock wallet → guards → route → debit (amount + any service charge from a debit slab) → write the
 *      transaction row as pending / stage 'initiated' → COMMIT;
 *   B. (no transaction) call the provider with our client_ref;
 *   C. (transaction 2) by the answer:
 *      - success: row success, then settle (user's commission, uplines' chain share, admin margin);
 *      - provider says pending: row stays pending, nothing is paid out yet;
 *      - definite refusal (isDefiniteFailure): refund everything debited, row failed, then the error is thrown;
 *      - unknown (timeout, network error ...): row stays pending (stage 'unknown'), money stays held; the status-check job /
 *        callback / reconciliation / an admin settles it later through finalize().
 *   A row left 'initiated' by a crash between A and C is picked up by the status check after a few minutes.
 *
 * `providerCall(clientRef, route)` is the adapter call; `route` (providerRouter) names the API picked for this service / user
 * and carries its `api`, `spKey` and `providerId` (saved on the row).
 */
async function run({ user, service, operator = null, mode = null, target = null, amount, charge = 0, providerCall, remark }) {
  const base = Number(amount) + Number(charge);
  if (!Number.isFinite(base) || base <= 0) throw err(400, 'INVALID_AMOUNT', 'Enter a valid amount');

  // ── A. hold the money and record the attempt ──
  const a = await db.transaction(async (trx) => {
    const u = await trx('users').where({ id: user.id }).forUpdate()
      .first('wallet_balance', 'user_type_id', 'plan_id', 'user_code', 'username');
    const userCode = u.user_code || u.username;
    // KYC, service on, service access, daily limit — checked under the wallet lock so
    // two concurrent requests cannot both slip under the daily limit.
    const svc = await serviceGuard.check({ trx, userId: user.id, serviceName: service, amount });
    // Which API this goes through (Customer Switch → Product Switch → Mock), before any money moves.
    const route = await providerRouter.resolve({ trx, userId: user.id, serviceName: service, service: svc, operator, mode });

    // The user's own slab decides whether they earn (credit) or pay a service charge (debit).
    const slab = await commission.findSlab({
      trx, userTypeId: u.user_type_id, planId: u.plan_id, serviceName: service, amount, operator, mode, userCode,
    });
    const slabAmounts = slab ? commission.computeAmounts({ commissionType: slab.commission_type, value: slab.value, amount }) : null;
    const serviceCharge = slab && slab.txn_type === 'debit' ? slabAmounts.net : 0;

    const before = Number(u.wallet_balance);
    const totalDebit = round2(base + serviceCharge);
    if (before < totalDebit) {
      throw err(400, 'INSUFFICIENT_BALANCE', serviceCharge
        ? `Insufficient wallet balance (amount ₹${base.toFixed(2)} + service charge ₹${serviceCharge.toFixed(2)})`
        : 'Insufficient wallet balance');
    }

    const afterAmount = (await wallet.debit(trx, { userId: user.id, amount: base, service, remark: remark || `${service} — ${target || ''}`.trim() })).after;
    let afterDebit = afterAmount;
    if (serviceCharge > 0) {
      afterDebit = (await wallet.debit(trx, {
        userId: user.id, amount: serviceCharge, service: `${service} Charge`,
        remark: `Service charge ${slabAmounts.commission.toFixed(2)} + GST ${slabAmounts.gst.toFixed(2)}`,
      })).after;
    }

    const clientRef = newClientRef();
    const [txnRow] = await trx('service_transactions').insert({
      user_id: user.id, service, operator, target, amount, client_ref: clientRef, debit_amount: totalDebit, service_charge: serviceCharge, mode,
      provider_id: route.providerId, sp_key: route.spKey, status: 'pending', stage: 'initiated', response: JSON.stringify({ stage: 'initiated' }),
    }).returning('id');
    return {
      txnId: typeof txnRow === 'object' ? txnRow.id : txnRow, clientRef, route, userTypeId: u.user_type_id, slab, serviceCharge, totalDebit,
      before, afterAmount, afterDebit,
    };
  });

  // ── B. call the provider: no transaction, no wallet lock ──
  let provider = null;
  let failure = null;
  try { provider = await providerCall(a.clientRef, a.route); } catch (e) { failure = e; }

  // ── C. settle by the answer ──
  const receiptBase = { ok: true, clientRef: a.clientRef, amount: Number(amount), charge: round2(Number(charge) + a.serviceCharge), beforeBalance: a.before };
  const done = await db.transaction(async (trx) => {
    const t = await trx('service_transactions').where({ id: a.txnId }).forUpdate().first();
    if (t.status !== 'pending') {
      // A callback / status check settled it while we waited for the provider: report what happened, change nothing.
      if (t.status === 'failed') return { thrown: err(502, 'PROVIDER_FAILED', 'Service failed') };
      return { receipt: { ...receiptBase, status: t.status, reference: t.reference_id, provider: { status: t.status }, commission: 0, balance: await wallet.lock(trx, user.id) } };
    }

    if (failure) {
      if (isDefiniteFailure(failure)) {
        await wallet.credit(trx, { userId: user.id, amount: a.totalDebit, service, remark: `Refund — ${service} failed` });
        await trx('service_transactions').where({ id: a.txnId }).update({
          status: 'failed', stage: null, response: JSON.stringify({ error: failure.message, code: failure.code }), finalized_at: trx.fn.now(), finalized_by: 'provider',
        });
        return { thrown: err(failure.status || 502, failure.code || 'PROVIDER_FAILED', failure.message || 'Service failed') };
      }
      // Unknown outcome: it may have gone through. Keep the money held and let the status check settle it.
      await trx('service_transactions').where({ id: a.txnId }).update({ stage: 'unknown', response: JSON.stringify({ stage: 'unknown', error: failure.message, code: failure.code || null }) });
      return { receipt: { ...receiptBase, status: 'pending', reference: null, provider: { status: 'pending', note: 'Waiting for the provider to confirm' }, commission: 0, balance: a.afterDebit } };
    }

    const reference = provider.ref || provider.rrn || null;
    const isPending = provider.status === 'pending';
    await trx('service_transactions').where({ id: a.txnId }).update({
      status: isPending ? 'pending' : 'success', stage: null, reference_id: reference, response: JSON.stringify(provider),
      finalized_at: isPending ? null : trx.fn.now(), finalized_by: isPending ? null : 'provider',
    });
    const receipt = { ...receiptBase, status: isPending ? 'pending' : 'success', reference, provider };
    if (isPending) return { receipt: { ...receipt, commission: 0, balance: a.afterDebit } };

    const settled = await settleSuccess(trx, {
      userId: user.id, userTypeId: a.userTypeId, slab: a.slab, service, operator, mode, amount, serviceTransactionId: a.txnId,
      providerId: a.route.providerId, serviceCharge: a.serviceCharge, balanceNow: await wallet.lock(trx, user.id),
      chargeWallet: a.serviceCharge > 0 ? { before: a.afterAmount, after: a.afterDebit } : null,
    });
    return { receipt: { ...receipt, commission: settled.ownCommission, balance: settled.finalBalance } };
  });
  if (done.thrown) throw done.thrown; // thrown only AFTER the refund / failed row was committed
  return done.receipt;
}

/**
 * Pay everything a successful transaction earns, inside the caller's transaction:
 * the user's own slab (credit = commission; a debit slab's charge was already taken),
 * each upline's chain share, and the admin-margin row. `balanceNow` is the user's
 * current (locked) balance.
 */
async function settleSuccess(trx, c) {
  let finalBalance = c.balanceNow;
  let ownCommission = 0;
  // A debit slab is a service charge, already taken from the wallet: just record it.
  if (c.slab && c.slab.txn_type === 'debit') {
    await commission.recordServiceCommission({
      trx, userId: c.userId, userTypeId: c.userTypeId, slab: c.slab, serviceName: c.service, amount: c.amount,
      wallet: c.chargeWallet || { before: c.balanceNow }, level: 0, sourceUserId: c.userId, serviceTransactionId: c.serviceTransactionId,
    });
  }
  // Credit commission for the user and every upline, after commission packages.
  const shares = await commission.resolveShares({
    trx, sourceUserId: c.userId, selfSlab: c.slab, serviceName: c.service, amount: c.amount, operator: c.operator, mode: c.mode,
  });
  // The company pays commission only out of what it earns on this transaction (the API's rate + any service charge collected).
  const providerCommission = await commission.providerCommissionFor({ trx, providerId: c.providerId || null, serviceName: c.service, amount: c.amount, operator: c.operator, mode: c.mode });
  commission.capShares(shares, providerCommission + Number(c.serviceCharge || 0));
  const own = shares[0];
  const comm = own && own.slab && own.gross > 0 ? await commission.recordServiceCommission({
    trx, userId: c.userId, userTypeId: c.userTypeId, slab: own.slab, serviceName: c.service, amount: c.amount,
    wallet: { before: c.balanceNow }, level: 0, sourceUserId: c.userId, serviceTransactionId: c.serviceTransactionId,
    remark: own.note ? `${c.service} — commission, ${own.note}` : null,
  }) : null;
  if (comm && comm.net > 0 && comm.walletTxnType === 'credit') {
    ownCommission = comm.net;
    finalBalance = (await wallet.credit(trx, {
      userId: c.userId, amount: comm.net, service: `${c.service} Commission`,
      remark: `Commission ${comm.commission.toFixed(2)} (GST ${comm.gst.toFixed(2)}, TDS ${comm.tds.toFixed(2)})${own.note ? ` — ${own.note}` : ''}`,
    })).after;
  }
  const chain = await commission.payUplines({ trx, nodes: shares, serviceName: c.service, amount: c.amount, serviceTransactionId: c.serviceTransactionId });
  const chainPaid = chain.reduce((s, x) => s + x.net, 0);
  await commission.recordAdminMargin({
    trx, serviceTransactionId: c.serviceTransactionId, userId: c.userId, serviceName: c.service, amount: c.amount,
    providerId: c.providerId || null, providerCommission, operator: c.operator, mode: c.mode, chargesCollected: Number(c.serviceCharge || 0), commissionPaid: round2(ownCommission + chainPaid),
  });
  return { finalBalance, ownCommission };
}

/**
 * Settle a PENDING transaction exactly once. `outcome` is 'success' or 'failed';
 * `source` is callback | status_check | reconciliation | admin. Row-locked and
 * idempotent: a transaction that is no longer pending is left untouched, so a late or
 * repeated callback can never pay twice or refund twice.
 * Returns { changed, status, row }.
 */
async function finalize(serviceTransactionId, outcome, { source, providerRef = null, note = null } = {}) {
  if (!['success', 'failed'].includes(outcome)) throw err(400, 'INVALID_STATUS', 'Outcome must be success or failed');
  return db.transaction(async (trx) => {
    const t = await trx('service_transactions').where({ id: serviceTransactionId }).forUpdate().first();
    if (!t) throw err(404, 'NOT_FOUND', 'Transaction not found');
    if (t.status !== 'pending') return { changed: false, status: t.status, row: t };

    // Lock the user (child) before settleSuccess locks uplines (parents) — same order as run().
    const u = await trx('users').where({ id: t.user_id }).forUpdate()
      .first('wallet_balance', 'user_type_id', 'plan_id', 'user_code', 'username');
    const balanceNow = Number(u.wallet_balance);
    const done = { status: outcome, stage: null, finalized_at: trx.fn.now(), finalized_by: source, final_note: note };

    if (outcome === 'failed') {
      const refund = Number(t.debit_amount != null ? t.debit_amount : t.amount);
      await wallet.credit(trx, { userId: t.user_id, amount: refund, service: t.service, remark: `Refund — ${t.service} failed (${source})` });
      await trx('service_transactions').where({ id: t.id }).update(done);
      return { changed: true, status: 'failed', row: { ...t, ...done } };
    }

    await trx('service_transactions').where({ id: t.id }).update({ ...done, reference_id: providerRef || t.reference_id });
    const slab = await commission.findSlab({
      trx, userTypeId: u.user_type_id, planId: u.plan_id, serviceName: t.service, amount: t.amount,
      operator: t.operator, mode: t.mode, userCode: u.user_code || u.username,
    });
    // A debit slab's charge was taken when the transaction started (t.service_charge).
    await settleSuccess(trx, {
      userId: t.user_id, userTypeId: u.user_type_id, slab, service: t.service, operator: t.operator, mode: t.mode,
      amount: Number(t.amount), serviceTransactionId: t.id, providerId: t.provider_id, serviceCharge: Number(t.service_charge || 0), balanceNow,
      chargeWallet: slab && slab.txn_type === 'debit' ? { before: balanceNow, after: balanceNow } : null,
    });
    return { changed: true, status: 'success', row: { ...t, ...done } };
  });
}

module.exports = { run, finalize, isDefiniteFailure };
