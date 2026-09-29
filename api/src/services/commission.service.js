'use strict';

const db = require('../config/db');

/**
 * Commission engine. For a successful service transaction it pays:
 *   - the user who did the transaction (level 0), from their own slab, and
 *   - every active upline in the parent chain (level 1, 2, ...), each from THEIR own
 *     user type + plan slab, but only slabs marked chain_type = 'chain'.
 * Upline shares are paid on top of the user's share (not cut from it). Each payout
 * writes a commission_ledger row (backs the GST/TDS/commission reports).
 *
 * Slab chain_type: 'self' = pays only on the slab owner's own transactions;
 * 'chain' = also pays when someone below them in the chain transacts.
 */
const DEFAULT_GST = 18; // % on the commission
const DEFAULT_TDS = 5;  // % on the commission
const MAX_CHAIN_LEVELS = 10;

const round2 = (n) => Math.round(n * 100) / 100;

function computeAmounts({ commissionType, value, amount, gstPercent = DEFAULT_GST, tdsPercent = DEFAULT_TDS }) {
  const base = commissionType === 'amount' ? Number(value) : (Number(amount) * Number(value)) / 100;
  const commission = round2(base);
  const gst = Math.round(commission * gstPercent) / 100;
  const tds = Math.round(commission * tdsPercent) / 100;
  const net = round2(commission + gst); // charge incl. GST
  return { commission, gst, tds, net };
}

// Slab for a user type + service + amount. With a plan, only that plan's slabs count
// (users without a plan keep matching any plan).
async function findSlab({ userTypeId, planId = null, serviceName, amount, chainOnly = false, creditOnly = false, trx }) {
  const q = (trx || db)('commission_slots as cs')
    .join('services as s', 's.id', 'cs.service_id')
    .where('cs.user_type_id', userTypeId)
    .where('s.title', serviceName)
    .where('cs.is_active', true)
    .andWhere('cs.min_amount', '<=', amount)
    .andWhere('cs.max_amount', '>=', amount);
  if (planId) q.where('cs.plan_id', planId);
  if (chainOnly) q.where('cs.chain_type', 'chain');
  if (creditOnly) q.where('cs.txn_type', 'credit');
  return q.orderBy('cs.id').first('cs.commission_type', 'cs.value', 'cs.txn_type');
}

/**
 * Write one commission_ledger row for `userId`. Returns null when no slab matches.
 * `wallet.before` is the earner's balance before this payout; the caller credits the
 * wallet when walletTxnType is 'credit'.
 */
async function recordServiceCommission({
  trx, userId, userTypeId, planId = null, serviceName, amount, wallet = {}, remark = null,
  level = 0, sourceUserId = null, serviceTransactionId = null, chainOnly = false, creditOnly = false,
  gstPercent = DEFAULT_GST, tdsPercent = DEFAULT_TDS,
}) {
  const slab = await findSlab({ userTypeId, planId, serviceName, amount, chainOnly, creditOnly, trx });
  if (!slab) return null;
  const { commission, gst, tds, net } = computeAmounts({ commissionType: slab.commission_type, value: slab.value, amount, gstPercent, tdsPercent });
  const walletTxnType = slab.txn_type || 'credit';
  const before = wallet.before != null ? Number(wallet.before) : 0;
  const after = walletTxnType === 'credit' ? round2(before + net) : before;
  const [row] = await (trx || db)('commission_ledger').insert({
    user_id: userId,
    service_name: serviceName,
    slot_type: slab.commission_type,
    type_value: slab.value,
    type_value_amount: commission,
    gst_percent: gstPercent, gst_amount: gst,
    tds_percent: tdsPercent, tds_amount: tds,
    net_amount: net,
    wallet_txn_type: walletTxnType,
    wallet_txn_amount: net,
    remark: remark || `${serviceName} — Service Charge ${commission.toFixed(2)}, GST ${gst.toFixed(2)}, TDS ${tds.toFixed(2)}`,
    before_balance: before,
    updated_balance: after,
    level,
    source_user_id: sourceUserId || userId,
    service_transaction_id: serviceTransactionId,
  }).returning('id');
  const id = typeof row === 'object' ? row.id : row;
  return { id, commission, gst, tds, net, walletTxnType, after };
}

/**
 * Walk up the parent chain of `sourceUserId` and credit each active upline its own
 * 'chain' slab. Must run inside the caller's transaction; wallets are locked child
 * → parent, the same order every transaction uses, so concurrent txns can't deadlock.
 * Returns [{ userId, level, net }].
 */
async function distributeChainCommission({ trx, sourceUserId, serviceName, amount, serviceTransactionId = null }) {
  const source = await trx('users').where({ id: sourceUserId }).first('parent_id', 'user_code', 'username');
  if (!source) return [];
  const sourceCode = source.user_code || source.username;
  const seen = new Set([sourceUserId]);
  const credits = [];
  let parentId = source.parent_id;

  for (let level = 1; parentId && level <= MAX_CHAIN_LEVELS; level += 1) {
    if (seen.has(parentId)) break; // defensive: a bad cycle in old data must not loop
    seen.add(parentId);
    // eslint-disable-next-line no-await-in-loop
    const p = await trx('users').where({ id: parentId }).forUpdate()
      .first('id', 'parent_id', 'user_type_id', 'plan_id', 'wallet_balance', 'is_active');
    if (!p) break;
    parentId = p.parent_id;
    if (!p.is_active || !p.user_type_id) continue; // blocked uplines earn nothing; the chain continues above them

    const before = Number(p.wallet_balance);
    // eslint-disable-next-line no-await-in-loop
    const comm = await recordServiceCommission({
      trx, userId: p.id, userTypeId: p.user_type_id, planId: p.plan_id, serviceName, amount,
      wallet: { before }, level, sourceUserId, serviceTransactionId, chainOnly: true, creditOnly: true,
      remark: `${serviceName} — chain commission from ${sourceCode} (level ${level})`,
    });
    if (!comm || comm.net <= 0) continue;

    // eslint-disable-next-line no-await-in-loop
    await trx('users').where({ id: p.id }).update({ wallet_balance: comm.after, updated_at: trx.fn.now() });
    // eslint-disable-next-line no-await-in-loop
    await trx('account_transactions').insert({
      user_id: p.id, service_name: `${serviceName} Commission`, type: 'credit', amount: comm.net,
      before_balance: before, updated_balance: comm.after,
      remark: `Chain commission from ${sourceCode} (level ${level}): ${comm.commission.toFixed(2)} (GST ${comm.gst.toFixed(2)}, TDS ${comm.tds.toFixed(2)})`,
    });
    credits.push({ userId: p.id, level, net: comm.net });
  }
  return credits;
}

module.exports = { computeAmounts, findSlab, recordServiceCommission, distributeChainCommission, DEFAULT_GST, DEFAULT_TDS, MAX_CHAIN_LEVELS };
