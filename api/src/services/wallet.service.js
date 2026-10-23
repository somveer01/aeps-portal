'use strict';

const { round2 } = require('../utils/money');

/**
 * The ONE place a wallet balance changes. Every money move (service debit, refund, commission, fund transfer, fund
 * request, admin wallet) goes through credit() / debit(), inside the caller's transaction, so each change:
 *   - locks the wallet row (SELECT ... FOR UPDATE) before reading the balance;
 *   - never lets a debit take the wallet below zero (throws 400 INSUFFICIENT_BALANCE, nothing written);
 *   - writes its account_transactions (ledger) row with the before / after balance in the same transaction.
 * So a wallet and its ledger cannot drift apart (`npm run check:ledger` proves it on any database).
 *
 * LOCK ORDER: when one transaction touches several wallets, lock them child -> parent (the transacting user first, then
 * the uplines; a fund transfer locks the receiver, then the sender). Every flow uses that order, so two transactions can
 * never wait for each other. Do not invent another order (e.g. by id).
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

/** Lock a wallet row and return its current balance (a number); null when the user does not exist. */
async function lock(trx, userId) {
  const row = await trx('users').where({ id: userId }).forUpdate().first('wallet_balance');
  return row ? Number(row.wallet_balance) : null;
}

/**
 * Change one wallet and write its ledger row. `type` 'credit' adds, 'debit' subtracts.
 * Returns { before, after } (numbers).
 *   service  - ledger "service_name" (e.g. 'Mobile Recharge', 'Fund Transfer', 'Admin Wallet')
 *   remark   - ledger text
 */
async function apply(trx, { userId, type, amount, service, remark = null, insufficientMessage = 'Insufficient wallet balance' }) {
  if (type !== 'credit' && type !== 'debit') throw err(500, 'WALLET_BAD_TYPE', 'Wallet change must be a credit or a debit');
  const value = round2(Number(amount));
  if (!Number.isFinite(value) || value <= 0) throw err(400, 'INVALID_AMOUNT', 'Enter a valid amount');
  const before = await lock(trx, userId);
  if (before === null) throw err(404, 'WALLET_USER_NOT_FOUND', 'User not found');
  const after = round2(type === 'credit' ? before + value : before - value);
  if (after < 0) throw err(400, 'INSUFFICIENT_BALANCE', insufficientMessage);
  await trx('users').where({ id: userId }).update({ wallet_balance: after, updated_at: trx.fn.now() });
  await trx('account_transactions').insert({
    user_id: userId, service_name: service, type, amount: value, before_balance: before, updated_balance: after, remark,
  });
  return { before, after };
}

const credit = (trx, opts) => apply(trx, { ...opts, type: 'credit' });
const debit = (trx, opts) => apply(trx, { ...opts, type: 'debit' });

module.exports = { lock, apply, credit, debit };
