'use strict';

const db = require('../config/db');

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
  async list({ startDate, endDate, userTypeId, userId, transferType, fromUserId = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (fromUserId) qb.where('x.from_user_id', fromUserId);
      if (startDate) qb.whereRaw('x.created_at::date >= ?', [startDate]);
      if (endDate) qb.whereRaw('x.created_at::date <= ?', [endDate]);
      if (userTypeId) qb.where('tu.user_type_id', userTypeId);
      if (userId) qb.where('x.to_user_id', userId);
      if (transferType) qb.where('x.transfer_type', transferType);
    };
    const countRow = await joins().where(filter).count('x.id as c').first();
    const rows = await joins().where(filter).select(...COLS).orderBy('x.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return joins().where('x.id', id).select(...COLS).first(); },

  // Atomically move funds between the sender's (admin's) wallet and the
  // receiver's wallet — a true zero-sum transfer, like a real fintech
  // distributor→retailer ledger: crediting the receiver DEBITS the sender by
  // the same amount (and vice-versa for a debit), each side guarded ≥0.
  // Writes an account_transactions ledger row on BOTH sides + one
  // fund_transfers record. Returns { ok, error, id }.
  async transfer({ fromUserId, toUserId, amount, transferType, remark, senderLabel = 'admin' }) {
    return db.transaction(async (trx) => {
      const receiver = await trx('users').where({ id: toUserId }).forUpdate().first('wallet_balance', 'full_name');
      if (!receiver) return { ok: false, error: 'Receiver not found' };

      let sender = null;
      if (fromUserId) {
        sender = await trx('users').where({ id: fromUserId }).forUpdate().first('wallet_balance', 'full_name');
        if (!sender) return { ok: false, error: 'Sender not found' };
      }

      const receiverBefore = Number(receiver.wallet_balance);
      const delta = transferType === 'debit' ? -amount : amount; // effect on the receiver
      const receiverAfter = receiverBefore + delta;
      if (receiverAfter < 0) return { ok: false, error: 'Insufficient receiver balance for debit' };

      let senderBefore = null;
      let senderAfter = null;
      if (sender) {
        senderBefore = Number(sender.wallet_balance);
        senderAfter = senderBefore - delta; // sender moves opposite to the receiver
        if (senderAfter < 0) return { ok: false, error: `Insufficient ${senderLabel === 'admin' ? 'admin ' : ''}wallet balance for this transfer` };
      }

      await trx('users').where({ id: toUserId }).update({ wallet_balance: receiverAfter, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: toUserId, service_name: 'Fund Transfer', type: transferType === 'debit' ? 'debit' : 'credit',
        remark: remark || `Fund ${transferType} by ${senderLabel}`, amount, before_balance: receiverBefore, updated_balance: receiverAfter,
      });

      if (sender) {
        await trx('users').where({ id: fromUserId }).update({ wallet_balance: senderAfter, updated_at: trx.fn.now() });
        await trx('account_transactions').insert({
          user_id: fromUserId, service_name: 'Fund Transfer', type: transferType === 'debit' ? 'credit' : 'debit',
          remark: remark || `Fund ${transferType} — ${receiver.full_name}`, amount, before_balance: senderBefore, updated_balance: senderAfter,
        });
      }

      const [row] = await trx('fund_transfers').insert({
        from_user_id: fromUserId, to_user_id: toUserId, amount, transfer_type: transferType,
        remark: remark || null, before_balance: receiverBefore, updated_balance: receiverAfter, status: 'success',
      }).returning('id');
      return { ok: true, id: typeof row === 'object' ? row.id : row };
    });
  },
};
