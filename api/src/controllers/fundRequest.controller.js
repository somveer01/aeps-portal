'use strict';

const { parseGrid } = require('../utils/gridQuery');
const db = require('../config/db');
const reportsRepo = require('../repositories/reports.repo');
const audit = require('../repositories/audit.repo');
const svc = require('../services/fundRequest.service');
const txnAuth = require('../services/txnAuth.service');

/**
 * Fund requests for every managed user (retailer, distributor, master distributor) and
 * approval by whoever created them. All lists return the admin /api/fund-requests shape
 * so the admin Fund Requests screen is reused for "mine" and "network" modes.
 */
const clean = (v) => String(v || '').trim();
const intOrNull = (v) => (v ? parseInt(v, 10) || null : null);
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
function listFilters(req) {
  return {
    startDate: clean(req.query.startDate) || null, endDate: clean(req.query.endDate) || null,
    userTypeId: intOrNull(req.query.userTypeId), userId: intOrNull(req.query.userId),
    status: ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null,
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10)),
  };
}

// GET /api/my/fund-request/meta — who approves my requests, and where to deposit.
async function myMeta(req, res, next) {
  try {
    const approver = await svc.approverFor(req.user.id);
    const isAdmin = approver.role === 'admin';
    const banks = isAdmin
      ? await db('company_banks').where({ is_active: true }).orderBy('id').select('id', 'bank_name', 'account_holder', 'account_no', 'ifsc_code')
      : [];
    return res.json({
      approver: { code: approver.user_code || approver.username, name: approver.full_name, isAdmin },
      banks, modes: svc.MODES,
    });
  } catch (err) { return next(err); }
}

// GET /api/my/fund-requests — my own requests.
async function myList(req, res, next) {
  try {
    const f = listFilters(req);
    const { rows, total } = await reportsRepo.fundRequests({ ...f, userTypeId: null, userId: null, ownerId: req.user.id, grid: parseGrid(req.query, reportsRepo.FUND_REQUEST_GRID) });
    return res.json({ rows, total, page: f.page, pageSize: f.pageSize });
  } catch (err) { return next(err); }
}

// POST /api/my/fund-requests { amount, paymentMode, depositDate, utr, companyBankId?, proofImage?, remark }
async function myCreate(req, res, next) {
  try {
    const id = await svc.create(req.user.id, req.body || {});
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'fund_request_created', detail: { id, amount: Number(req.body.amount) }, ...meta(req) });
    return res.status(201).json({ row: await reportsRepo.fundRequestById(id) });
  } catch (err) { return sendError(err, res, next); }
}

// GET /api/network/fund-requests — requests I must approve (users I created).
async function networkList(req, res, next) {
  try {
    const f = listFilters(req);
    const { rows, total } = await reportsRepo.fundRequests({ ...f, approverId: req.user.id, grid: parseGrid(req.query, reportsRepo.FUND_REQUEST_GRID) });
    return res.json({ rows, total, page: f.page, pageSize: f.pageSize });
  } catch (err) { return next(err); }
}

// PUT /api/network/fund-requests/:id { status, adminRemark, transactionPassword }
// Approving moves money out of my wallet, so it needs my transaction PIN / password.
async function networkAct(req, res, next) {
  try {
    const status = req.body && req.body.status;
    if (status === 'approved' && !(await txnAuth.verify(req.user.id, req.body.transactionPassword))) {
      return res.status(401).json({ error: 'Invalid transaction password/PIN', code: 'BAD_TXN_PASSWORD' });
    }
    return await actAndRespond(req, res, { id: req.user.id, role: req.user.role });
  } catch (err) { return sendError(err, res, next); }
}

// PUT /api/fund-requests/:id — admin acts on requests from users the admin created.
async function adminAct(req, res, next) {
  try { return await actAndRespond(req, res, { id: req.user.id, role: 'admin' }); } catch (err) { return sendError(err, res, next); }
}

async function actAndRespond(req, res, actor) {
  const id = parseInt(req.params.id, 10);
  const status = req.body && req.body.status;
  const fr = await svc.act(id, actor, { status, remark: req.body && req.body.adminRemark });
  await audit.log({ userId: req.user.id, username: req.user.username, event: 'fund_request_action', detail: { id, status, amount: fr.amount, userId: fr.user_id }, ...meta(req) });
  return res.json({ row: await reportsRepo.fundRequestById(id) });
}

function sendError(err, res, next) {
  if (err.status && err.code) return res.status(err.status).json({ error: err.message, code: err.code });
  return next(err);
}

module.exports = { myMeta, myList, myCreate, networkList, networkAct, adminAct };
