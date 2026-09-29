'use strict';

const repo = require('../repositories/reports.repo');
const db = require('../config/db');
const audit = require('../repositories/audit.repo');

const clean = (v) => String(v || '').trim();
function filters(req) {
  return {
    startDate: clean(req.query.startDate) || null,
    endDate: clean(req.query.endDate) || null,
    userTypeId: req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null,
    userId: req.query.userId ? parseInt(req.query.userId, 10) : null,
    service: clean(req.query.service) || null,
    status: clean(req.query.status) || null,
    type: ['credit', 'debit'].includes(req.query.type) ? req.query.type : null,
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10)),
  };
}

async function accountHistory(req, res, next) {
  try { const f = filters(req); const { rows, total } = await repo.accountTransactions(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

async function serviceReport(req, res, next) {
  try { const f = filters(req); const { rows, total } = await repo.serviceTransactions(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

async function fundRequests(req, res, next) {
  try { const f = filters(req); const { rows, total } = await repo.fundRequests(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

async function gstReport(req, res, next) {
  try { const f = filters(req); const { rows, total } = await repo.commissionLedger(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

async function tdsReport(req, res, next) {
  try { const f = filters(req); const { rows, total } = await repo.commissionLedger(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

// PUT /api/fund-requests/:id  { status: 'approved'|'rejected', adminRemark }
async function actOnFundRequest(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const fr = await repo.fundRequestById(id);
    if (!fr) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    if (fr.status !== 'pending') return res.status(409).json({ error: 'Request already processed', code: 'ALREADY_PROCESSED' });
    const status = req.body.status;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected', code: 'INVALID_STATUS' });
    const adminRemark = clean(req.body.adminRemark);

    if (status === 'approved') {
      // Credit the user's wallet and record a ledger entry, atomically.
      await db.transaction(async (trx) => {
        const user = await trx('users').where({ id: fr.user_id }).first('wallet_balance');
        const before = Number(user.wallet_balance);
        const after = before + Number(fr.amount);
        await trx('users').where({ id: fr.user_id }).update({ wallet_balance: after, updated_at: trx.fn.now() });
        await trx('account_transactions').insert({
          user_id: fr.user_id, service_name: 'Fund Request', type: 'credit',
          remark: `Fund request ${fr.request_id} approved`, amount: fr.amount, before_balance: before, updated_balance: after,
        });
        await trx('fund_requests').where({ id }).update({ status, admin_remark: adminRemark, updated_at: trx.fn.now() });
      });
    } else {
      await repo.updateFundRequest(id, { status, admin_remark: adminRemark });
    }
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'fund_request_action', detail: { id, status, amount: fr.amount, userId: fr.user_id }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.json({ row: await repo.fundRequestById(id) });
  } catch (err) { return next(err); }
}

// GET /api/admin-margin-report — what the company keeps per transaction, with totals.
async function adminMarginReport(req, res, next) {
  try { const f = filters(req); const r = await repo.adminMargins(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

module.exports = { accountHistory, serviceReport, fundRequests, actOnFundRequest, gstReport, tdsReport, adminMarginReport };
