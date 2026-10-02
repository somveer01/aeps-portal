'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const commission = require('./commission.service');
const serviceGuard = require('./serviceGuard.service');

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const round2 = (n) => Math.round(n * 100) / 100;
// Our own unique id for each attempt; sent to the provider and used by callbacks.
const newClientRef = () => `TX${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * The single money pipeline used by every paid retailer service.
 *
 *   lock wallet → guards → debit (amount + any service charge from a debit slab)
 *   → call provider with our client_ref
 *   → success: record it, then settle (user's commission, uplines' chain share, admin margin);
 *   → pending: record it and stop — the money stays debited, nothing is paid out yet; the
 *     provider callback, the status-check job, reconciliation or an admin settles it later
 *     through finalize();
 *   → failure: refund everything debited and record a failed row.
 *
 * Runs in one DB transaction. `providerCall(clientRef)` is the mock/live adapter call.
 */
async function run({ user, service, operator = null, mode = null, target = null, amount, charge = 0, providerCall, remark }) {
  const base = Number(amount) + Number(charge);
  if (!Number.isFinite(base) || base <= 0) throw err(400, 'INVALID_AMOUNT', 'Enter a valid amount');

  return db.transaction(async (trx) => {
    const u = await trx('users').where({ id: user.id }).forUpdate()
      .first('wallet_balance', 'user_type_id', 'plan_id', 'user_code', 'username');
    const userCode = u.user_code || u.username;
    // KYC, service on, service access, daily limit — checked under the wallet lock so
    // two concurrent requests cannot both slip under the daily limit.
    await serviceGuard.check({ trx, userId: user.id, serviceName: service, amount });

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

    const afterAmount = round2(before - base);
    await trx('account_transactions').insert({
      user_id: user.id, service_name: service, type: 'debit', amount: base,
      before_balance: before, updated_balance: afterAmount, remark: remark || `${service} — ${target || ''}`.trim(),
    });
    const afterDebit = round2(afterAmount - serviceCharge);
    if (serviceCharge > 0) {
      await trx('account_transactions').insert({
        user_id: user.id, service_name: `${service} Charge`, type: 'debit', amount: serviceCharge,
        before_balance: afterAmount, updated_balance: afterDebit,
        remark: `Service charge ${slabAmounts.commission.toFixed(2)} + GST ${slabAmounts.gst.toFixed(2)}`,
      });
    }
    await trx('users').where({ id: user.id }).update({ wallet_balance: afterDebit, updated_at: trx.fn.now() });

    const clientRef = newClientRef();
    const txnBase = { user_id: user.id, service, operator, target, amount, client_ref: clientRef, debit_amount: totalDebit, service_charge: serviceCharge, mode };

    let provider;
    try {
      provider = await providerCall(clientRef);
    } catch (e) {
      // Refund + record failure (still commit so the refund + failed row persist).
      await trx('users').where({ id: user.id }).update({ wallet_balance: before, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: user.id, service_name: service, type: 'credit', amount: totalDebit,
        before_balance: afterDebit, updated_balance: before, remark: `Refund — ${service} failed`,
      });
      await trx('service_transactions').insert({
        ...txnBase, status: 'failed', reference_id: null, response: JSON.stringify({ error: e.message, code: e.code }),
        finalized_at: trx.fn.now(), finalized_by: 'provider',
      });
      throw err(e.status || 502, e.code || 'PROVIDER_FAILED', e.message || 'Service failed');
    }

    const reference = provider.ref || provider.rrn || null;
    const isPending = provider.status === 'pending';
    const [txnRow] = await trx('service_transactions').insert({
      ...txnBase, status: isPending ? 'pending' : 'success', reference_id: reference, response: JSON.stringify(provider),
      finalized_at: isPending ? null : trx.fn.now(), finalized_by: isPending ? null : 'provider',
    }).returning('id');
    const serviceTransactionId = typeof txnRow === 'object' ? txnRow.id : txnRow;

    const receipt = {
      ok: true, status: isPending ? 'pending' : 'success', reference, clientRef, provider,
      amount: Number(amount), charge: round2(Number(charge) + serviceCharge), beforeBalance: before,
    };
    if (isPending) return { ...receipt, commission: 0, balance: afterDebit };

    const settled = await settleSuccess(trx, {
      userId: user.id, userTypeId: u.user_type_id, slab, service, operator, mode, amount, serviceTransactionId,
      serviceCharge, balanceNow: afterDebit, chargeWallet: serviceCharge > 0 ? { before: afterAmount, after: afterDebit } : null,
    });
    return { ...receipt, commission: settled.ownCommission, balance: settled.finalBalance };
  });
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
  const own = shares[0];
  const comm = own && own.slab && own.gross > 0 ? await commission.recordServiceCommission({
    trx, userId: c.userId, userTypeId: c.userTypeId, slab: own.slab, serviceName: c.service, amount: c.amount,
    wallet: { before: c.balanceNow }, level: 0, sourceUserId: c.userId, serviceTransactionId: c.serviceTransactionId,
    remark: own.note ? `${c.service} — commission, ${own.note}` : null,
  }) : null;
  if (comm && comm.net > 0 && comm.walletTxnType === 'credit') {
    ownCommission = comm.net;
    finalBalance = round2(c.balanceNow + comm.net);
    await trx('users').where({ id: c.userId }).update({ wallet_balance: finalBalance, updated_at: trx.fn.now() });
    await trx('account_transactions').insert({
      user_id: c.userId, service_name: `${c.service} Commission`, type: 'credit', amount: comm.net,
      before_balance: c.balanceNow, updated_balance: finalBalance,
      remark: `Commission ${comm.commission.toFixed(2)} (GST ${comm.gst.toFixed(2)}, TDS ${comm.tds.toFixed(2)})${own.note ? ` — ${own.note}` : ''}`,
    });
  }
  const chain = await commission.payUplines({ trx, nodes: shares, serviceName: c.service, amount: c.amount, serviceTransactionId: c.serviceTransactionId });
  const chainPaid = chain.reduce((s, x) => s + x.net, 0);
  await commission.recordAdminMargin({
    trx, serviceTransactionId: c.serviceTransactionId, userId: c.userId, serviceName: c.service, amount: c.amount,
    chargesCollected: Number(c.serviceCharge || 0), commissionPaid: round2(ownCommission + chainPaid),
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
    const done = { status: outcome, finalized_at: trx.fn.now(), finalized_by: source, final_note: note };

    if (outcome === 'failed') {
      const refund = Number(t.debit_amount != null ? t.debit_amount : t.amount);
      const after = round2(balanceNow + refund);
      await trx('users').where({ id: t.user_id }).update({ wallet_balance: after, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: t.user_id, service_name: t.service, type: 'credit', amount: refund,
        before_balance: balanceNow, updated_balance: after, remark: `Refund — ${t.service} failed (${source})`,
      });
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
      amount: Number(t.amount), serviceTransactionId: t.id, serviceCharge: Number(t.service_charge || 0), balanceNow,
      chargeWallet: slab && slab.txn_type === 'debit' ? { before: balanceNow, after: balanceNow } : null,
    });
    return { changed: true, status: 'success', row: { ...t, ...done } };
  });
}

module.exports = { run, finalize };
