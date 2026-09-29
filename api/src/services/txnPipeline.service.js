'use strict';

const db = require('../config/db');
const commission = require('./commission.service');

const err = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * The single money pipeline used by every paid retailer service.
 *
 *   lock wallet → guarded debit → call provider → on success: service_transactions,
 *   commission (+GST/TDS) via commission.service, credit commission to wallet, then
 *   credit each upline's chain share;
 *   on failure: refund the debit and record a failed service_transactions row.
 *
 * Runs in one DB transaction. `providerCall()` is the mock/live adapter call.
 * Returns a receipt payload. Wrap the route with the idempotency middleware and
 * audit after commit.
 */
async function run({ user, service, operator = null, target = null, amount, charge = 0, providerCall, remark }) {
  const debit = Number(amount) + Number(charge);
  if (!Number.isFinite(debit) || debit <= 0) throw err(400, 'INVALID_AMOUNT', 'Enter a valid amount');

  return db.transaction(async (trx) => {
    const u = await trx('users').where({ id: user.id }).forUpdate().first('wallet_balance', 'user_type_id', 'plan_id');
    const before = Number(u.wallet_balance);
    if (before < debit) throw err(400, 'INSUFFICIENT_BALANCE', 'Insufficient wallet balance');

    const afterDebit = before - debit;
    await trx('users').where({ id: user.id }).update({ wallet_balance: afterDebit, updated_at: trx.fn.now() });
    await trx('account_transactions').insert({
      user_id: user.id, service_name: service, type: 'debit', amount: debit,
      before_balance: before, updated_balance: afterDebit, remark: remark || `${service} — ${target || ''}`.trim(),
    });

    let provider;
    try {
      provider = await providerCall();
    } catch (e) {
      // Refund + record failure (still commit so the refund + failed row persist).
      await trx('users').where({ id: user.id }).update({ wallet_balance: before, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: user.id, service_name: service, type: 'credit', amount: debit,
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

    // Commission (+GST/TDS) → commission_ledger; credit net commission to wallet.
    let finalBalance = afterDebit;
    const comm = await commission.recordServiceCommission({
      trx, userId: user.id, userTypeId: u.user_type_id, planId: u.plan_id, serviceName: service, amount,
      wallet: { before: afterDebit }, level: 0, sourceUserId: user.id, serviceTransactionId,
    });
    if (comm && comm.net > 0 && comm.walletTxnType === 'credit') {
      finalBalance = afterDebit + comm.net;
      await trx('users').where({ id: user.id }).update({ wallet_balance: finalBalance, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: user.id, service_name: `${service} Commission`, type: 'credit', amount: comm.net,
        before_balance: afterDebit, updated_balance: finalBalance,
        remark: `Commission ${comm.commission.toFixed(2)} (GST ${comm.gst.toFixed(2)}, TDS ${comm.tds.toFixed(2)})`,
      });
    }

    // Upline shares (distributor, master distributor ...) in the same transaction.
    await commission.distributeChainCommission({ trx, sourceUserId: user.id, serviceName: service, amount, serviceTransactionId });

    return {
      ok: true,
      reference: provider.ref || provider.rrn || null,
      provider,
      amount: Number(amount),
      charge: Number(charge),
      commission: comm ? comm.net : 0,
      beforeBalance: before,
      balance: finalBalance,
    };
  });
}

module.exports = { run };
