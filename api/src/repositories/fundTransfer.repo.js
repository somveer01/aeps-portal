'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, DATE_COL } = require('../utils/gridQuery');
const wallet = require('../services/wallet.service');
const { round2 } = require('../utils/money');

// Sortable / filterable grid columns (keys = the app's DataGrid column keys).
const GRID = {
  from: { sort: 'fu.user_code', filter: "concat_ws(' ', coalesce(fu.user_code, 'admin'), coalesce(fu.full_name, 'admin'))" },
  to: { sort: 'tu.user_code', filter: "concat_ws(' ', tu.user_code, tu.full_name, tu.shop_name)" },
  amount: 'x.amount', transfer_type: 'x.transfer_type', remark: 'x.remark', wallet: 'x.updated_balance',
  status: { sort: 'x.status', filter: "coalesce(x.status, 'success')" }, created_at: DATE_COL('x.created_at'),
};

function joins() {
  return db('fund_transfers as x')
    .leftJoin('users as fu', 'fu.id', 'x.from_user_id')
    .join('users as tu', 'tu.id', 'x.to_user_id')
    .leftJoin('user_types as ut', 'ut.id', 'tu.user_type_id');
}
const COLS = [
  'x.*',
  'fu.full_name as from_name', 'fu.user_code as from_code', 'fu.mobile as from_mobile', 'fu.shop_name as from_outlet',
  'tu.full_name as to_name', 'tu.user_code as to_code', 'tu.mobile as to_mobile', 'tu.shop_name as to_outlet', 'ut.name as to_user_type',
];

module.exports = {
  GRID,
  async list({ startDate, endDate, userTypeId, userId, transferType, fromUserId = null, grid = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (fromUserId) qb.where('x.from_user_id', fromUserId);
      if (startDate) qb.whereRaw('x.created_at::date >= ?', [startDate]);
      if (endDate) qb.whereRaw('x.created_at::date <= ?', [endDate]);
      if (userTypeId) qb.where('tu.user_type_id', userTypeId);
      if (userId) qb.where('x.to_user_id', userId);
      if (transferType) qb.where('x.transfer_type', transferType);
      applyGridFilters(qb, grid);
    };
    const countRow = await joins().where(filter).count('x.id as c').first();
    const rows = await joins().where(filter).select(...COLS).modify((qb) => applyGridSortFirst(qb, grid)).orderBy('x.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return joins().where('x.id', id).select(...COLS).first(); },

  // Atomically move funds between the sender's (admin's) wallet and the
  // receiver's wallet — a true zero-sum transfer, like a real fintech
  // distributor→retailer ledger: crediting the receiver DEBITS the sender by
  // the same amount (and vice-versa for a debit), each side guarded ≥0.
  // Writes an account_transactions ledger row on BOTH sides + one
  // fund_transfers record. Returns { ok, error, id }.
  async transfer({ fromUserId, toUserId, amount: rawAmount, transferType, remark, senderLabel = 'admin' }) {
    const amount = round2(Number(rawAmount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a valid amount' };
    // Paying yourself would write both wallet updates onto one row and lose the amount.
    if (fromUserId && Number(fromUserId) === Number(toUserId)) return { ok: false, error: 'Sender and receiver cannot be the same user' };
    return db.transaction(async (trx) => {
      const receiver = await trx('users').where({ id: toUserId }).forUpdate().first('wallet_balance', 'full_name');
      if (!receiver) return { ok: false, error: 'Receiver not found' };

      let sender = null;
      if (fromUserId) {
        sender = await trx('users').where({ id: fromUserId }).forUpdate().first('wallet_balance', 'full_name', 'role');
        if (!sender) return { ok: false, error: 'Sender not found' };
      }

      const receiverBefore = Number(receiver.wallet_balance);
      const delta = transferType === 'debit' ? -amount : amount; // effect on the receiver
      const receiverAfter = round2(receiverBefore + delta);
      if (receiverAfter < 0) return { ok: false, error: 'Insufficient receiver balance for debit' };

      let senderBefore = null;
      let senderAfter = null;
      if (sender) {
        senderBefore = Number(sender.wallet_balance);
        senderAfter = round2(senderBefore - delta); // sender moves opposite to the receiver
        if (senderAfter < 0) return { ok: false, error: `Insufficient ${senderLabel === 'admin' ? 'admin ' : ''}wallet balance for this transfer` };
      }

      // Both wallets are locked and checked above (receiver first, then sender: child -> parent), so neither write can fail half way.
      const received = await wallet.apply(trx, {
        userId: toUserId, type: transferType === 'debit' ? 'debit' : 'credit', amount, service: 'Fund Transfer',
        remark: remark || `Fund ${transferType} by ${senderLabel}`,
      });

      if (sender) {
        const sent = await wallet.apply(trx, {
          userId: fromUserId, type: transferType === 'debit' ? 'credit' : 'debit', amount, service: 'Fund Transfer',
          remark: remark || `Fund ${transferType} — ${receiver.full_name}`,
        });
        // The admin's own Wallet History (Admin Wallet screen) must show every move of the admin wallet, not only the manual top-ups.
        if (sender.role === 'admin') {
          await trx('admin_wallet_transactions').insert({
            admin_id: fromUserId, amount, txn_type: transferType === 'debit' ? 'credit' : 'debit',
            remark: remark || `Fund ${transferType === 'debit' ? 'taken back from' : 'sent to'} ${receiver.full_name}`,
            before_balance: sent.before, updated_balance: sent.after,
          });
        }
      }

      const [row] = await trx('fund_transfers').insert({
        from_user_id: fromUserId, to_user_id: toUserId, amount, transfer_type: transferType,
        remark: remark || null, before_balance: received.before, updated_balance: received.after, status: 'success',
      }).returning('id');
      return { ok: true, id: typeof row === 'object' ? row.id : row };
    });
  },
};
