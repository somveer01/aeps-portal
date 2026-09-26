'use strict';

const db = require('../config/db');

/**
 * Commission engine. Given a completed service transaction (user + service +
 * amount), it finds the applicable commission slab, computes the commission and
 * the GST + TDS deductions, and writes a `commission_ledger` row (which backs
 * the GST and TDS reports). This is the single source of truth for those
 * reports — call it from the transaction pipeline when live service rails land,
 * replacing the demo seed data.
 *
 * Rates default to India's typical AEPS values but are overridable per call.
 */
const DEFAULT_GST = 18; // % on the commission
const DEFAULT_TDS = 5;  // % on the commission

function computeAmounts({ commissionType, value, amount, gstPercent = DEFAULT_GST, tdsPercent = DEFAULT_TDS }) {
  const base = commissionType === 'amount' ? Number(value) : (Number(amount) * Number(value)) / 100;
  const commission = Math.round(base * 100) / 100;
  const gst = Math.round(commission * gstPercent) / 100;
  const tds = Math.round(commission * tdsPercent) / 100;
  const net = Math.round((commission + gst) * 100) / 100; // charge incl. GST
  return { commission, gst, tds, net };
}

// Find the slab matching user's type + service + amount range.
async function findSlab({ userTypeId, serviceName, amount, trx }) {
  return (trx || db)('commission_slots as cs')
    .join('services as s', 's.id', 'cs.service_id')
    .where('cs.user_type_id', userTypeId)
    .where('s.title', serviceName)
    .where('cs.is_active', true)
    .andWhere('cs.min_amount', '<=', amount)
    .andWhere('cs.max_amount', '>=', amount)
    .first('cs.commission_type', 'cs.value', 'cs.txn_type');
}

/**
 * Record commission for a service transaction. Returns the ledger row id, or
 * null if no matching slab exists. `wallet` = { before, after } after the
 * service charge was applied to the user's wallet.
 */
async function recordServiceCommission({ trx, userId, userTypeId, serviceName, amount, wallet = {}, remark = null, gstPercent = DEFAULT_GST, tdsPercent = DEFAULT_TDS }) {
  const slab = await findSlab({ userTypeId, serviceName, amount, trx });
  if (!slab) return null;
  const { commission, gst, tds, net } = computeAmounts({ commissionType: slab.commission_type, value: slab.value, amount, gstPercent, tdsPercent });
  const [row] = await (trx || db)('commission_ledger').insert({
    user_id: userId,
    service_name: serviceName,
    slot_type: slab.commission_type,
    type_value: slab.value,
    type_value_amount: commission,
    gst_percent: gstPercent, gst_amount: gst,
    tds_percent: tdsPercent, tds_amount: tds,
    net_amount: net,
    wallet_txn_type: slab.txn_type || 'credit',
    wallet_txn_amount: net,
    remark: remark || `${serviceName} — Service Charge ${commission.toFixed(2)}, GST ${gst.toFixed(2)}, TDS ${tds.toFixed(2)}`,
    before_balance: wallet.before != null ? wallet.before : 0,
    updated_balance: wallet.after != null ? wallet.after : 0,
  }).returning('id');
  const id = typeof row === 'object' ? row.id : row;
  return { id, commission, gst, tds, net, walletTxnType: slab.txn_type || 'credit' };
}

module.exports = { computeAmounts, findSlab, recordServiceCommission, DEFAULT_GST, DEFAULT_TDS };
