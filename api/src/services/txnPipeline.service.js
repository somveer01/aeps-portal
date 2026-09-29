'use strict';

const db = require('../config/db');
const commission = require('./commission.service');

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The single money pipeline used by every paid retailer service.
 *
 *   lock wallet → guarded debit (amount + any service charge from a debit slab)
 *   → call provider
 *   → success: service_transactions, user's commission (credit slab), each upline's
 *     chain share, admin margin row;
 *   → failure: refund everything debited and record a failed service_transactions row.
 *
 * Runs in one DB transaction. `providerCall()` is the mock/live adapter call.
 * `mode` (e.g. IMPS / NEFT) lets operator-specific slabs match a transfer mode.
 * Returns a receipt payload. Wrap the route with the idempotency middleware and
 * audit after commit.
 */
async function run({ user, service, operator = null, mode = null, target = null, amount, charge = 0, providerCall, remark }) {
  const base = Number(amount) + Number(charge);
  if (!Number.isFinite(base) || base <= 0) throw err(400, 'INVALID_AMOUNT', 'Enter a valid amount');

  return db.transaction(async (trx) => {
    const u = await trx('users').where({ id: user.id }).forUpdate()
      .first('wallet_balance', 'user_type_id', 'plan_id', 'user_code', 'username');
    const userCode = u.user_code || u.username;

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

    let provider;
    try {
      provider = await providerCall();
    } catch (e) {
      // Refund + record failure (still commit so the refund + failed row persist).
      await trx('users').where({ id: user.id }).update({ wallet_balance: before, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: user.id, service_name: service, type: 'credit', amount: totalDebit,
        before_balance: afterDebit, updated_balance: before, remark: `Refund — ${service} failed`,
      });
      await trx('service_transactions').insert({
        user_id: user.id, service, operator, target, amount, status: 'failed',
        reference_id: null, response: JSON.stringify({ error: e.message, code: e.code }),
      });
      throw err(e.status || 502, e.code || 'PROVIDER_FAILED', e.message || 'Service failed');
    }

    const [txnRow] = await trx('service_transactions').insert({
      user_id: user.id, service, operator, target, amount, status: 'success',
      reference_id: provider.ref || provider.rrn || null, response: JSON.stringify(provider),
    }).returning('id');
    const serviceTransactionId = typeof txnRow === 'object' ? txnRow.id : txnRow;

    // Ledger row for the user's own slab; credit the wallet when it is a commission.
    let finalBalance = afterDebit;
    let ownCommission = 0;
    const comm = slab ? await commission.recordServiceCommission({
      trx, userId: user.id, userTypeId: u.user_type_id, slab, serviceName: service, amount,
      wallet: serviceCharge > 0 ? { before: afterAmount, after: afterDebit } : { before: afterDebit },
      level: 0, sourceUserId: user.id, serviceTransactionId,
    }) : null;
    if (comm && comm.net > 0 && comm.walletTxnType === 'credit') {
      ownCommission = comm.net;
      finalBalance = round2(afterDebit + comm.net);
      await trx('users').where({ id: user.id }).update({ wallet_balance: finalBalance, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: user.id, service_name: `${service} Commission`, type: 'credit', amount: comm.net,
        before_balance: afterDebit, updated_balance: finalBalance,
        remark: `Commission ${comm.commission.toFixed(2)} (GST ${comm.gst.toFixed(2)}, TDS ${comm.tds.toFixed(2)})`,
      });
    }

    // Upline shares (distributor, master distributor ...) in the same transaction.
    const chain = await commission.distributeChainCommission({ trx, sourceUserId: user.id, serviceName: service, amount, operator, mode, serviceTransactionId });
    const chainPaid = chain.reduce((s, c) => s + c.net, 0);

    await commission.recordAdminMargin({
      trx, serviceTransactionId, userId: user.id, serviceName: service, amount,
      chargesCollected: serviceCharge, commissionPaid: round2(ownCommission + chainPaid),
    });

    return {
      ok: true,
      reference: provider.ref || provider.rrn || null,
      provider,
      amount: Number(amount),
      charge: round2(Number(charge) + serviceCharge),
      commission: ownCommission,
      beforeBalance: before,
      balance: finalBalance,
    };
  });
}

module.exports = { run };
