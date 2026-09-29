'use strict';

const db = require('../config/db');

/**
 * Fund requests. Any managed user (retailer, distributor, master distributor) asks for
 * wallet balance; the user who created them approves it:
 *   - approver is the admin: the requester deposited into a company bank, so approval
 *     credits their wallet (new money into the system);
 *   - approver is a distributor / MD: the requester paid them directly, so approval is a
 *     zero-sum move from the approver's wallet to the requester's.
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const MODES = ['NEFT', 'IMPS', 'RTGS', 'UPI', 'Cash', 'Cheque'];
const round2 = (n) => Math.round(n * 100) / 100;

// Who approves this user's requests: their creator, or the admin when unknown.
async function approverFor(userId) {
  const u = await db('users').where({ id: userId }).first('created_by');
  if (u && u.created_by) {
    const c = await db('users').where({ id: u.created_by }).first('id', 'role', 'user_code', 'username', 'full_name');
    if (c) return c;
  }
  return db('users').where({ role: 'admin' }).orderBy('id').first('id', 'role', 'user_code', 'username', 'full_name');
}

async function create(userId, b) {
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) throw err(400, 'INVALID_AMOUNT', 'Enter a valid amount');
  if (amount > 10000000) throw err(400, 'INVALID_AMOUNT', 'Amount is too large');
  const paymentMode = MODES.includes(b.paymentMode) ? b.paymentMode : null;
  if (!paymentMode) throw err(400, 'INVALID_MODE', `Payment mode must be one of ${MODES.join(', ')}`);
  const utr = String(b.utr || '').trim().toUpperCase();
  if (paymentMode !== 'Cash' && !/^[A-Z0-9]{6,30}$/.test(utr)) throw err(400, 'INVALID_UTR', 'Enter the UTR / reference number (6–30 letters or digits)');
  const depositDate = String(b.depositDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depositDate) || Number.isNaN(Date.parse(depositDate))) throw err(400, 'INVALID_DATE', 'Choose the deposit date');
  if (new Date(depositDate) > new Date()) throw err(400, 'INVALID_DATE', 'Deposit date cannot be in the future');
  const proof = String(b.proofImage || '').trim();
  if (proof && !/^\/uploads\/[\w.-]+$/.test(proof)) throw err(400, 'INVALID_PROOF', 'Upload the payment proof again');

  const approver = await approverFor(userId);
  let companyBankId = null;
  if (approver.role === 'admin') {
    companyBankId = parseInt(b.companyBankId, 10) || null;
    if (!companyBankId || !(await db('company_banks').where({ id: companyBankId, is_active: true }).first('id'))) {
      throw err(400, 'INVALID_BANK', 'Choose the company bank you deposited into');
    }
  }
  if (utr && await db('fund_requests').whereRaw('upper(trim(receipt_no)) = ?', [utr]).whereIn('status', ['pending', 'approved']).first('id')) {
    throw err(409, 'DUPLICATE_UTR', 'This UTR / reference number is already used in another request');
  }

  const requestId = `FR${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
  try {
    const [row] = await db('fund_requests').insert({
      user_id: userId, approver_id: approver.id, company_bank_id: companyBankId, deposit_date: depositDate,
      payment_mode: paymentMode, amount: round2(amount), request_id: requestId, receipt_no: utr || null,
      receipt_img: proof || null, remark: String(b.remark || '').trim().slice(0, 500) || null, status: 'pending',
    }).returning('id');
    return typeof row === 'object' ? row.id : row;
  } catch (e) {
    if (e.code === '23505') throw err(409, 'DUPLICATE_UTR', 'This UTR / reference number is already used in another request');
    throw e;
  }
}

/**
 * Approve or reject. `actor` = { id, role }. Only the request's approver may act (the
 * admin also acts on requests with no approver). Row-locked so a request is settled once.
 */
async function act(id, actor, { status, remark }) {
  if (!['approved', 'rejected'].includes(status)) throw err(400, 'INVALID_STATUS', 'Status must be approved or rejected');
  const note = String(remark || '').trim().slice(0, 500) || null;

  return db.transaction(async (trx) => {
    const fr = await trx('fund_requests').where({ id }).forUpdate().first();
    if (!fr) throw err(404, 'NOT_FOUND', 'Not found');
    const mine = fr.approver_id ? fr.approver_id === actor.id : actor.role === 'admin';
    if (!mine) throw err(403, 'NOT_APPROVER', 'Only the user who created this account can act on its fund requests');
    if (fr.status !== 'pending') throw err(409, 'ALREADY_PROCESSED', 'Request already processed');

    if (status === 'approved') {
      const amount = Number(fr.amount);
      // Lock requester then approver (child → parent, the order every money flow uses).
      const user = await trx('users').where({ id: fr.user_id }).forUpdate().first('wallet_balance', 'is_active');
      if (!user.is_active) throw err(400, 'USER_BLOCKED', 'This user is blocked');
      if (actor.role !== 'admin') {
        const me = await trx('users').where({ id: actor.id }).forUpdate().first('wallet_balance');
        const myBefore = Number(me.wallet_balance);
        if (myBefore < amount) throw err(400, 'INSUFFICIENT_BALANCE', `Your wallet has ₹${myBefore.toFixed(2)}; add balance before approving ₹${amount.toFixed(2)}`);
        const myAfter = round2(myBefore - amount);
        await trx('users').where({ id: actor.id }).update({ wallet_balance: myAfter, updated_at: trx.fn.now() });
        await trx('account_transactions').insert({
          user_id: actor.id, service_name: 'Fund Request', type: 'debit', amount,
          before_balance: myBefore, updated_balance: myAfter, remark: `Fund request ${fr.request_id} approved`,
        });
      }
      const before = Number(user.wallet_balance);
      const after = round2(before + amount);
      await trx('users').where({ id: fr.user_id }).update({ wallet_balance: after, updated_at: trx.fn.now() });
      await trx('account_transactions').insert({
        user_id: fr.user_id, service_name: 'Fund Request', type: 'credit', amount,
        before_balance: before, updated_balance: after, remark: `Fund request ${fr.request_id} approved`,
      });
    }
    await trx('fund_requests').where({ id }).update({ status, admin_remark: note, acted_by: actor.id, acted_at: trx.fn.now(), updated_at: trx.fn.now() });
    return fr;
  });
}

module.exports = { MODES, approverFor, create, act };
