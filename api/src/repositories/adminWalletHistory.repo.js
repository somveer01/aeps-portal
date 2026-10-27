'use strict';

/**
 * The Admin Wallet screen's own history (admin_wallet_transactions): one row for every move of the admin wallet - manual top-ups and
 * debits, fund transfers, and fund requests the admin approves. The wallet ledger itself (account_transactions) is written by
 * services/wallet.service.js; this only keeps the admin's screen history in step with it, from inside the same transaction.
 *   type: 'credit' | 'debit' (what happened to the ADMIN wallet), before / after = the admin wallet around the move.
 * Returns the new row id.
 */
async function record(trx, { adminId, type, amount, remark, before, after }) {
  const [row] = await trx('admin_wallet_transactions').insert({
    admin_id: adminId, amount, txn_type: type, remark, before_balance: before, updated_balance: after,
  }).returning('id');
  return typeof row === 'object' ? row.id : row;
}

module.exports = { record };
