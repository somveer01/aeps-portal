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
  try { const f = { ...filters(req), grid: parseGrid(req.query, repo.COMMISSION_GRID) }; const { rows, total } = await repo.commissionLedger(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

async function tdsReport(req, res, next) {
  try { const f = { ...filters(req), grid: parseGrid(req.query, repo.COMMISSION_GRID) }; const { rows, total } = await repo.commissionLedger(f); return res.json({ rows, total, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

// GET /api/commission-report — every commission paid (own + chain), with level / source filters and totals.
async function commissionReport(req, res, next) {
  try {
    const lv = clean(req.query.level).toLowerCase();
    const f = {
      ...filters(req), grid: parseGrid(req.query, repo.COMMISSION_GRID),
      level: lv === 'own' ? 0 : (/^\d{1,2}$/.test(lv) ? parseInt(lv, 10) : undefined), fromDownline: lv === 'downline',
      sourceUserId: req.query.sourceUserId ? parseInt(req.query.sourceUserId, 10) : null,
      txnType: ['credit', 'debit'].includes(req.query.type) ? req.query.type : null,
    };
    const r = await repo.commissionLedger(f);
    return res.json({ ...r, page: f.page, pageSize: f.pageSize });
  } catch (err) { return next(err); }
}

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null);

// GET /api/user-summary-report — one row per managed user: transactions, commission earned (own / from downline),
// service charges paid, wallet added, refunds, the company's margin on the user's transactions, and totals.
async function userSummary(req, res, next) {
  try {
    const f = { ...filters(req), startDate: isoDate(req.query.startDate), endDate: isoDate(req.query.endDate), grid: parseGrid(req.query, repo.USER_SUMMARY_GRID) };
    const r = await repo.userSummary(f);
    return res.json({ ...r, page: f.page, pageSize: f.pageSize });
  } catch (err) { return next(err); }
}

// GET /api/user-summary-report/:id — the same numbers for one user, split per service.
async function userSummaryDetail(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const r = Number.isInteger(id) ? await repo.userSummaryDetail(id, { startDate: isoDate(req.query.startDate), endDate: isoDate(req.query.endDate) }) : null;
    if (!r) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return res.json(r);
  } catch (err) { return next(err); }
}

// PUT /api/fund-requests/:id  { status: 'approved'|'rejected', adminRemark }
// GET /api/admin-margin-report — what the company keeps per transaction, with totals.
async function adminMarginReport(req, res, next) {
  try { const f = { ...filters(req), grid: parseGrid(req.query, repo.MARGIN_GRID) }; const r = await repo.adminMargins(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); }
  catch (err) { return next(err); }
}

module.exports = { accountHistory, serviceReport, fundRequests, gstReport, tdsReport, commissionReport, adminMarginReport, userSummary, userSummaryDetail };
