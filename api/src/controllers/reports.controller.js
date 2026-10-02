'use strict';

const { parseGrid } = require('../utils/gridQuery');
const repo = require('../repositories/reports.repo');

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
  try { const f = { ...filters(req), grid: parseGrid(req.query, repo.ACCOUNT_GRID) }; const { rows, total } = await repo.accountTransactions(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

async function serviceReport(req, res, next) {
  try { const f = { ...filters(req), grid: parseGrid(req.query, repo.SERVICE_GRID) }; const { rows, total } = await repo.serviceTransactions(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

async function fundRequests(req, res, next) {
  try { const f = { ...filters(req), grid: parseGrid(req.query, repo.FUND_REQUEST_GRID) }; const { rows, total } = await repo.fundRequests(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
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
// GET /api/admin-margin-report — what the company keeps per transaction, with totals.
async function adminMarginReport(req, res, next) {
  try { const f = filters(req); const r = await repo.adminMargins(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

module.exports = { accountHistory, serviceReport, fundRequests, gstReport, tdsReport, adminMarginReport };
