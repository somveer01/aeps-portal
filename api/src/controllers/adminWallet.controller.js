'use strict';

const { parseGrid, applyGridFilters, applyGridSortFirst, DATE_COL } = require('../utils/gridQuery');
const db = require('../config/db');
const audit = require('../repositories/audit.repo');
const wallet = require('../services/wallet.service');
const adminWalletHistory = require('../repositories/adminWalletHistory.repo');
const { isMoneyAmount, toAmount } = require('../utils/money');

const clean = (v) => String(v || '').trim();

// GET /api/admin-wallet/balance -> current admin wallet balance
async function balance(req, res, next) {
  try {
    const u = await db('users').where({ id: req.user.id }).first('wallet_balance');
    return res.json({ balance: Number(u ? u.wallet_balance : 0) });
  } catch (err) { return next(err); }
}

// GET /api/admin-wallet  (Wallet Transaction History, filterable)
// Sortable / filterable grid columns of the Admin Wallet list.
const GRID = {
  amount: 'x.amount', txn_type: 'x.txn_type', before_balance: 'x.before_balance', updated_balance: 'x.updated_balance',
  remark: 'x.remark', user: { sort: 'u.full_name', filter: "concat_ws(' ', u.full_name, u.username)" }, created_at: DATE_COL('x.created_at'),
};

async function list(req, res, next) {
  try {
    const startDate = clean(req.query.startDate) || null;
    const endDate = clean(req.query.endDate) || null;
    const txnType = ['credit', 'debit'].includes(req.query.txnType) ? req.query.txnType : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const grid = parseGrid(req.query, GRID);

    const filter = (qb) => {
      qb.where('x.admin_id', req.user.id);
      if (startDate) qb.whereRaw('x.created_at::date >= ?', [startDate]);
      if (endDate) qb.whereRaw('x.created_at::date <= ?', [endDate]);
      if (txnType) qb.where('x.txn_type', txnType);
      applyGridFilters(qb, grid);
    };
    const joins = () => db('admin_wallet_transactions as x').join('users as u', 'u.id', 'x.admin_id');
    const countRow = await joins().where(filter).count('x.id as c').first();
    const rows = await joins().where(filter)
      .select('x.*', 'u.full_name as user_name', 'u.username as user_username')
      .modify((qb) => applyGridSortFirst(qb, grid))
      .orderBy('x.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    const bal = await db('users').where({ id: req.user.id }).first('wallet_balance');
    return res.json({ rows, total: Number(countRow.c), page, pageSize, balance: Number(bal ? bal.wallet_balance : 0) });
  } catch (err) { return next(err); }
}

// POST /api/admin-wallet/add  { amount, txnType, remark }
async function add(req, res, next) {
  try {
    const amount = toAmount(req.body.amount);
    const txnType = req.body.txnType === 'debit' ? 'debit' : (req.body.txnType === 'credit' ? 'credit' : null);
    if (!txnType) return res.status(400).json({ error: 'Choose a transaction type (credit/debit)', code: 'INVALID_TXN_TYPE' });
    if (!isMoneyAmount(amount)) return res.status(400).json({ error: 'Enter a valid amount (up to 2 decimals)', code: 'INVALID_AMOUNT' });
    const remark = clean(req.body.remark);
    if (remark.length < 1) return res.status(400).json({ error: 'Remark is required', code: 'NO_REMARK' });

    const result = await db.transaction(async (trx) => {
      if (txnType === 'debit' && (await wallet.lock(trx, req.user.id)) < amount) return { ok: false, error: 'Insufficient wallet balance for debit' };
      // The wallet service also writes the Account History row, so the admin wallet's balances chain with every other move.
      const w = await wallet.apply(trx, { userId: req.user.id, type: txnType, amount, service: 'Admin Wallet', remark });
      const id = await adminWalletHistory.record(trx, { adminId: req.user.id, type: txnType, amount, remark, before: w.before, after: w.after });
      return { ok: true, id, balance: w.after };
    });
    if (!result.ok) return res.status(400).json({ error: result.error, code: 'ADD_FAILED' });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'admin_wallet_adjust', detail: { amount, txnType, balance: result.balance }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.status(201).json({ ok: true, id: result.id, balance: result.balance });
  } catch (err) { return next(err); }
}

module.exports = { balance, list, add };
