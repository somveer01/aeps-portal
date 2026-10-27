'use strict';

const db = require('../config/db');
const wallet = require('./wallet.service');
const adminWalletHistory = require('../repositories/adminWalletHistory.repo');
const { round2, isMoneyAmount, toAmount } = require('../utils/money');

/**
 * Fund requests. Any managed user (retailer, distributor, super distributor, employee) asks for wallet
 * balance after depositing into one of the COMPANY bank accounts (chosen on the request), and the ADMIN
 * approves every request (owner's decision, 2026-10-15). Since 2026-10-27 the ADMIN WALLET is the treasury (owner's decision): approval
 * moves the amount from the approver's wallet to the requester's (debit + credit, both in the ledger; the admin's Admin Wallet history
 * shows it too) and is refused with INSUFFICIENT_BALANCE when that wallet cannot cover it, so no wallet money appears from nowhere. The
 * admin tops the wallet up with Add Fund when a deposit reaches the company bank. Distributors do not approve their users' requests (to
 * move their own balance down they use Fund Transfer); `act` still handles a request that names a non-admin approver the same way.
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const MODES = ['NEFT', 'IMPS', 'RTGS', 'UPI', 'Cash', 'Cheque'];

// Who approves fund requests: always the admin, whoever created the requester.
async function approverFor() {
  return db('users').where({ role: 'admin' }).orderBy('id').first('id', 'role', 'user_code', 'username', 'full_name');
}

async function create(userId, b) {
  const amount = toAmount(b.amount);
  if (!isMoneyAmount(amount)) throw err(400, 'INVALID_AMOUNT', 'Enter a valid amount');
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

  const approver = await approverFor();
  if (!approver) throw err(500, 'NO_ADMIN', 'No admin account to approve the request');
  // Every requester deposits into a company bank account and names it here.
  const companyBankId = parseInt(b.companyBankId, 10) || null;
  if (!companyBankId || !(await db('company_banks').where({ id: companyBankId, is_active: true }).first('id'))) {
    throw err(400, 'INVALID_BANK', 'Choose the company bank you deposited into');
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
      // The approver's wallet pays - the Admin wallet is the treasury, so a credit to a user always comes out of a wallet and no wallet money
      // is created from nothing. The Admin tops it up (Fund Management -> Add Fund) when the deposit reaches the company bank.
      const admin = actor.role === 'admin';
      const myBefore = await wallet.lock(trx, actor.id);
      if (myBefore < amount) {
        throw err(400, 'INSUFFICIENT_BALANCE', `${admin ? 'The Admin wallet' : 'Your wallet'} has ₹${myBefore.toFixed(2)}; add balance${admin ? ' (Fund Management → Add Fund)' : ''} before approving ₹${amount.toFixed(2)}`);
      }
      const paid = await wallet.apply(trx, { userId: actor.id, type: 'debit', amount, service: 'Fund Request', remark: `Fund request ${fr.request_id} approved` });
      // The Admin Wallet screen's own history must show every move of the admin wallet.
      if (admin) await adminWalletHistory.record(trx, { adminId: actor.id, type: 'debit', amount, remark: `Fund request ${fr.request_id} approved`, before: paid.before, after: paid.after });
      await wallet.credit(trx, { userId: fr.user_id, amount, service: 'Fund Request', remark: `Fund request ${fr.request_id} approved` });
    }
    await trx('fund_requests').where({ id }).update({ status, admin_remark: note, acted_by: actor.id, acted_at: trx.fn.now(), updated_at: trx.fn.now() });
    return fr;
  });
}

module.exports = { MODES, approverFor, create, act };
