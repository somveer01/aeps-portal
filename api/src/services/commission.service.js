'use strict';

const db = require('../config/db');
const serviceGuard = require('./serviceGuard.service');

/**
 * Commission engine. For a successful service transaction it pays:
 *   - the user who did the transaction (level 0), from their own slab, and
 *   - every active upline in the parent chain (level 1, 2, ...), each from THEIR own
 *     user type + plan slab, but only slabs marked chain_type = 'chain'.
 * Upline shares are paid on top of the user's share (not cut from it). Each payout
 * writes a commission_ledger row (backs the GST/TDS/commission reports).
 * Commission packages then let an upline move part of its own share to (or back from) its
 * direct downline; see resolveShares. The admin's total never changes.
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

/**
 * Slab for a user type + service + amount.
 *  - plan: with a plan, only that plan's slabs count (users without a plan match any plan).
 *  - operator: a slab with an operator applies only when the transaction's operator or
 *    transfer mode equals it (case-insensitive); a slab without one applies to all.
 *  - specific user: a slab naming a login id applies only to that user.
 * The most specific slab wins: specific user, then operator, then the oldest slab.
 */
async function findSlab({ userTypeId, planId = null, serviceName, amount, operator = null, mode = null, userCode = null, chainOnly = false, creditOnly = false, trx }) {
  const keys = [operator, mode].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  const code = String(userCode || '').trim().toLowerCase();
  const q = (trx || db)('commission_slots as cs')
    .join('services as s', 's.id', 'cs.service_id')
    .where('cs.user_type_id', userTypeId)
    .where('s.title', serviceName)
    .where('cs.is_active', true)
    .andWhere('cs.min_amount', '<=', amount)
    .andWhere('cs.max_amount', '>=', amount)
    .andWhere((w) => {
      w.whereRaw("coalesce(trim(cs.operator), '') = ''");
      if (keys.length) w.orWhereRaw(`lower(trim(cs.operator)) in (${keys.map(() => '?').join(',')})`, keys);
    })
    .andWhere((w) => {
      w.whereRaw("coalesce(trim(cs.specific_user), '') = ''");
      if (code) w.orWhereRaw('lower(trim(cs.specific_user)) = ?', [code]);
    });
  if (planId) q.where('cs.plan_id', planId);
  if (chainOnly) q.where('cs.chain_type', 'chain');
  if (creditOnly) q.where('cs.txn_type', 'credit');
  return q
    .orderByRaw("case when coalesce(trim(cs.specific_user), '') <> '' then 0 else 1 end")
    .orderByRaw("case when coalesce(trim(cs.operator), '') <> '' then 0 else 1 end")
    .orderBy('cs.id')
    .first('cs.id', 'cs.commission_type', 'cs.value', 'cs.txn_type');
}

/**
 * Write one commission_ledger row for `userId`. Returns null when no slab matches.
 * `wallet.before` is the earner's balance before this payout; the caller credits the
 * wallet when walletTxnType is 'credit'.
 */
async function recordServiceCommission({
  trx, userId, userTypeId, planId = null, userCode = null, operator = null, mode = null, slab: givenSlab = null,
  serviceName, amount, wallet = {}, remark = null,
  level = 0, sourceUserId = null, serviceTransactionId = null, chainOnly = false, creditOnly = false,
  gstPercent = DEFAULT_GST, tdsPercent = DEFAULT_TDS,
}) {
  const slab = givenSlab || await findSlab({ userTypeId, planId, serviceName, amount, operator, mode, userCode, chainOnly, creditOnly, trx });
  if (!slab) return null;
  const { commission, gst, tds, net } = computeAmounts({ commissionType: slab.commission_type, value: slab.value, amount, gstPercent, tdsPercent });
  const walletTxnType = slab.txn_type || 'credit';
  const before = wallet.before != null ? Number(wallet.before) : 0;
  // A debit slab is a service charge the caller has already taken (see txnPipeline).
  const after = wallet.after != null ? Number(wallet.after) : (walletTxnType === 'credit' ? round2(before + net) : round2(before - net));
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
async function distributeChainCommission({ trx, sourceUserId, serviceName, amount, operator = null, mode = null, serviceTransactionId = null }) {
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
      .first('id', 'parent_id', 'user_type_id', 'plan_id', 'wallet_balance', 'is_active', 'user_code', 'username');
    if (!p) break;
    parentId = p.parent_id;
    if (!p.is_active || !p.user_type_id) continue; // blocked uplines earn nothing; the chain continues above them

    const before = Number(p.wallet_balance);
    // eslint-disable-next-line no-await-in-loop
    const comm = await recordServiceCommission({
      trx, userId: p.id, userTypeId: p.user_type_id, planId: p.plan_id, userCode: p.user_code || p.username, operator, mode,
      serviceName, amount, wallet: { before }, level, sourceUserId, serviceTransactionId, chainOnly: true, creditOnly: true,
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

// ── Commission packages (an upline re-shares its own commission with its direct downline) ──

/**
 * The package item that sets `child`'s commission for a service: the child must hold an active
 * package owned by its CURRENT parent and made for the child's user type. An operator / mode item
 * beats the all-operators one, like slabs.
 */
async function packageItemFor({ trx = db, child, parentId, serviceId, operator = null, mode = null }) {
  if (!child.commission_package_id || !parentId || !serviceId) return null;
  const keys = [operator, mode].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  return trx('commission_package_items as i')
    .join('commission_packages as p', 'p.id', 'i.package_id')
    .where({ 'p.id': child.commission_package_id, 'p.owner_user_id': parentId, 'p.user_type_id': child.user_type_id, 'p.is_active': true, 'i.service_id': serviceId })
    .andWhere((w) => {
      w.whereRaw("coalesce(trim(i.operator), '') = ''");
      if (keys.length) w.orWhereRaw(`lower(trim(i.operator)) in (${keys.map(() => '?').join(',')})`, keys);
    })
    .orderByRaw("case when coalesce(trim(i.operator), '') <> '' then 0 else 1 end")
    .first('i.commission_type', 'i.value', 'p.name as package_name');
}

/**
 * Who earns how much credit commission on one successful transaction, after packages.
 * nodes[0] = the user who transacted (their credit self slab, if any); nodes[1..] = the uplines
 * with their chain slabs, walked and locked child → parent (same order as every transaction).
 * Packages apply top-down: the child gets its package amount and its parent's share moves by
 * the difference, so the admin pays the same total. A parent's share never drops below 0 —
 * the child is capped instead. Blocked uplines earn nothing and their packages do not apply.
 * Returns [{ user, level, active, slab, gross, note }]; `slab` is what the ledger records (the
 * admin slab, the package item, or a flat amount once a package changed the share).
 */
async function resolveShares({ trx, sourceUserId, selfSlab = null, serviceName, amount, operator = null, mode = null }) {
  const cols = ['id', 'parent_id', 'user_type_id', 'plan_id', 'wallet_balance', 'is_active', 'user_code', 'username', 'commission_package_id'];
  const source = await trx('users').where({ id: sourceUserId }).first(cols);
  if (!source) return [];
  const grossOf = (slab) => (slab ? computeAmounts({ commissionType: slab.commission_type, value: slab.value, amount }).commission : 0);
  const credit = selfSlab && (selfSlab.txn_type || 'credit') === 'credit' ? selfSlab : null;
  const nodes = [{ user: source, level: 0, active: true, slab: credit, gross: grossOf(credit), note: null }];

  const seen = new Set([sourceUserId]);
  let parentId = source.parent_id;
  for (let level = 1; parentId && level <= MAX_CHAIN_LEVELS; level += 1) {
    if (seen.has(parentId)) break; // defensive: a bad cycle in old data must not loop
    seen.add(parentId);
    // eslint-disable-next-line no-await-in-loop
    const p = await trx('users').where({ id: parentId }).forUpdate().first(cols);
    if (!p) break;
    parentId = p.parent_id;
    const active = !!(p.is_active && p.user_type_id);
    // eslint-disable-next-line no-await-in-loop
    const slab = active ? await findSlab({
      trx, userTypeId: p.user_type_id, planId: p.plan_id, userCode: p.user_code || p.username, operator, mode, serviceName, amount, chainOnly: true, creditOnly: true,
    }) : null;
    nodes.push({ user: p, level, active, slab, gross: grossOf(slab), note: null });
  }

  const svc = await serviceGuard.findService(serviceName, trx);
  const code = (u) => u.user_code || u.username;
  const addNote = (n, text) => { n.note = n.note ? `${n.note}; ${text}` : text; };
  for (let i = nodes.length - 2; i >= 0; i -= 1) {
    const child = nodes[i]; const parent = nodes[i + 1];
    if (!parent.active) continue;
    // eslint-disable-next-line no-await-in-loop
    const item = await packageItemFor({ trx, child: child.user, parentId: parent.user.id, serviceId: svc && svc.id, operator, mode });
    if (!item) continue;
    const want = grossOf({ commission_type: item.commission_type, value: item.value });
    let give = want;
    let parentShare = round2(parent.gross - (want - child.gross));
    if (parentShare < 0) { give = round2(want + parentShare); parentShare = 0; }
    child.slab = give === want ? { commission_type: item.commission_type, value: Number(item.value), txn_type: 'credit' } : { commission_type: 'amount', value: give, txn_type: 'credit' };
    child.gross = give;
    addNote(child, `package '${item.package_name}' by ${code(parent.user)}${give === want ? '' : ' (capped)'}`);
    if (parentShare !== parent.gross) {
      parent.slab = { commission_type: 'amount', value: parentShare, txn_type: 'credit' };
      parent.gross = parentShare;
      addNote(parent, `after package '${item.package_name}' to ${code(child.user)}`);
    }
  }
  return nodes;
}

/** Pay the uplines (nodes[1..]) from resolveShares: ledger row, wallet credit, account history. */
async function payUplines({ trx, nodes, serviceName, amount, serviceTransactionId }) {
  if (!nodes.length) return [];
  const source = nodes[0].user;
  const sourceCode = source.user_code || source.username;
  const credits = [];
  for (const n of nodes.slice(1)) {
    if (!n.active || !n.slab || n.gross <= 0) continue;
    const before = Number(n.user.wallet_balance);
    // eslint-disable-next-line no-await-in-loop
    const comm = await recordServiceCommission({
      trx, userId: n.user.id, userTypeId: n.user.user_type_id, slab: n.slab, serviceName, amount, wallet: { before }, level: n.level,
      sourceUserId: source.id, serviceTransactionId, remark: `${serviceName} — chain commission from ${sourceCode} (level ${n.level})${n.note ? `, ${n.note}` : ''}`,
    });
    if (!comm || comm.net <= 0) continue;
    // eslint-disable-next-line no-await-in-loop
    await trx('users').where({ id: n.user.id }).update({ wallet_balance: comm.after, updated_at: trx.fn.now() });
    // eslint-disable-next-line no-await-in-loop
    await trx('account_transactions').insert({
      user_id: n.user.id, service_name: `${serviceName} Commission`, type: 'credit', amount: comm.net,
      before_balance: before, updated_balance: comm.after,
      remark: `Chain commission from ${sourceCode} (level ${n.level}): ${comm.commission.toFixed(2)} (GST ${comm.gst.toFixed(2)}, TDS ${comm.tds.toFixed(2)})${n.note ? ` — ${n.note}` : ''}`,
    });
    credits.push({ userId: n.user.id, level: n.level, net: comm.net });
  }
  return credits;
}

/**
 * Record what the company keeps on one successful transaction:
 *   margin = provider commission + charges collected from the user − commission paid out.
 * Provider commission comes from the service (Service Master). A negative margin means
 * the slabs pay out more than the provider pays for this service.
 */
async function recordAdminMargin({ trx, serviceTransactionId, userId, serviceName, amount, chargesCollected = 0, commissionPaid = 0 }) {
  const svc = await trx('services').whereRaw('lower(title) = lower(?)', [serviceName])
    .first('provider_commission_type', 'provider_commission_value');
  const value = svc ? Number(svc.provider_commission_value) : 0;
  const providerCommission = round2(svc && svc.provider_commission_type === 'amount' ? value : (Number(amount) * value) / 100);
  const margin = round2(providerCommission + Number(chargesCollected) - Number(commissionPaid));
  await trx('admin_margins').insert({
    service_transaction_id: serviceTransactionId, user_id: userId, service_name: serviceName, amount,
    provider_commission: providerCommission, charges_collected: round2(chargesCollected), commission_paid: round2(commissionPaid), margin,
  });
  return { providerCommission, margin };
}

module.exports = {
  computeAmounts, findSlab, recordServiceCommission, distributeChainCommission, recordAdminMargin,
  packageItemFor, resolveShares, payUplines,
  DEFAULT_GST, DEFAULT_TDS, MAX_CHAIN_LEVELS,
};
