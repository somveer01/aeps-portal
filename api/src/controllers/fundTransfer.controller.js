'use strict';

const { parseGrid } = require('../utils/gridQuery');
const repo = require('../repositories/fundTransfer.repo');
const usersRepo = require('../repositories/usersManager.repo');
const db = require('../config/db');
const txnAuth = require('../services/txnAuth.service');
const audit = require('../repositories/audit.repo');

const clean = (v) => String(v || '').trim();

// GET /api/fund-transfer/lookup?code=DAC0160  -> receiver details
async function lookup(req, res, next) {
  try {
    const code = clean(req.query.code);
    if (!code) return res.status(400).json({ error: 'Enter a User Id', code: 'NO_CODE' });
    const u = await db('users').where({ user_code: code }).whereNotNull('user_type_id')
      .first('id', 'user_code', 'full_name', 'shop_name', 'mobile', 'wallet_balance');
    if (!u) return res.status(404).json({ error: 'No user found with this User Id', code: 'NOT_FOUND' });
    return res.json({
      user: { id: u.id, userCode: u.user_code, name: u.full_name, shopName: u.shop_name, mobile: u.mobile, walletBalance: u.wallet_balance },
    });
  } catch (err) { return next(err); }
}

async function list(req, res, next) {
  try {
    const { rows, total } = await repo.list({
      startDate: clean(req.query.startDate) || null,
      endDate: clean(req.query.endDate) || null,
      userTypeId: req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null,
      userId: req.query.userId ? parseInt(req.query.userId, 10) : null,
      transferType: ['credit', 'debit'].includes(req.query.transferType) ? req.query.transferType : null,
      grid: parseGrid(req.query, repo.GRID),
      page: Math.max(1, parseInt(req.query.page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10)),
    });
    return res.json({ rows, total });
  } catch (err) { return next(err); }
}

// POST /api/fund-transfers  { userId | code, amount, remark, txnType, transactionPassword }
async function create(req, res, next) {
  try {
    const amount = Number(req.body.amount);
    const transferType = req.body.txnType === 'debit' ? 'debit' : (req.body.txnType === 'credit' ? 'credit' : null);
    if (!transferType) return res.status(400).json({ error: 'Choose a transaction type (credit/debit)', code: 'INVALID_TXN_TYPE' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount', code: 'INVALID_AMOUNT' });

    // Resolve receiver by id or user_code.
    let toUserId = req.body.userId ? parseInt(req.body.userId, 10) : null;
    if (!toUserId && req.body.code) {
      const u = await db('users').where({ user_code: clean(req.body.code) }).whereNotNull('user_type_id').first('id');
      toUserId = u && u.id;
    }
    if (!toUserId || !(await usersRepo.findFull(toUserId))) return res.status(400).json({ error: 'Select a valid receiver', code: 'INVALID_RECEIVER' });

    // Authorize with the admin's transaction PIN (or login password if no PIN set).
    const okPw = await txnAuth.verify(req.user.id, req.body.transactionPassword);
    if (!okPw) return res.status(401).json({ error: 'Invalid transaction password/PIN', code: 'BAD_TXN_PASSWORD' });

    const result = await repo.transfer({ fromUserId: req.user.id, toUserId, amount, transferType, remark: clean(req.body.remark) });
    if (!result.ok) return res.status(400).json({ error: result.error, code: 'TRANSFER_FAILED' });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'fund_transfer', detail: { toUserId, amount, transferType }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.status(201).json({ row: await repo.findById(result.id) });
  } catch (err) { return next(err); }
}

module.exports = { lookup, list, create };
