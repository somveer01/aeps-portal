'use strict';

const db = require('../config/db');
const serviceGuard = require('../services/serviceGuard.service');
const permission = require('../services/servicePermission.service');
const reportsRepo = require('../repositories/reports.repo');
const commissionSlotRepo = require('../repositories/commissionSlot.repo');

const clean = (v) => String(v || '').trim();

// Owner-scoped report filters (userId is ALWAYS the caller — never trust the body).
function ownerFilters(req) {
  return {
    startDate: clean(req.query.startDate) || null,
    endDate: clean(req.query.endDate) || null,
    userId: req.user.id,
    userTypeId: null,
    service: clean(req.query.service) || null,
    status: clean(req.query.status) || null,
    type: ['credit', 'debit'].includes(req.query.type) ? req.query.type : null,
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10)),
  };
}

// GET /api/retailer/summary
async function summary(req, res, next) {
  try {
    const u = await db('users as u').leftJoin('user_types as ut', 'ut.id', 'u.user_type_id').where('u.id', req.user.id)
      .first('u.wallet_balance', 'u.kyc_status', 'u.ekyc_status', 'u.full_name', 'u.shop_name', 'u.user_code', 'ut.name as user_type_name');
    const today = await db('account_transactions').where({ user_id: req.user.id })
      .whereRaw('created_at::date = CURRENT_DATE').count('id as c').sum('amount as amt').first();
    const commToday = await db('commission_ledger').where({ user_id: req.user.id })
      .whereRaw('created_at::date = CURRENT_DATE').sum('net_amount as amt').first();
    return res.json({
      balance: Number(u ? u.wallet_balance : 0),
      kycStatus: u ? u.kyc_status : 'pending',
      ekycStatus: u ? u.ekyc_status : 'pending',
      name: u ? u.full_name : '', shopName: u ? u.shop_name : '', userCode: u ? u.user_code : '', userTypeName: (u && u.user_type_name) || 'Retailer',
      today: { count: Number(today.c || 0), amount: Number(today.amt || 0) },
      commissionToday: Number(commToday.amt || 0),
    });
  } catch (err) { return next(err); }
}

// GET /api/retailer/service-stats?from&to  (dashboard bar chart)
async function serviceStats(req, res, next) {
  try {
    const from = clean(req.query.from) || null;
    const to = clean(req.query.to) || null;
    const q = db('service_transactions').where({ user_id: req.user.id, status: 'success' });
    if (from) q.whereRaw('created_at::date >= ?', [from]);
    if (to) q.whereRaw('created_at::date <= ?', [to]);
    const rows = await q.select('service').sum('amount as amount').count('id as count').groupBy('service').orderBy('amount', 'desc');
    return res.json({ rows: rows.map((r) => ({ service: r.service, amount: Number(r.amount), count: Number(r.count) })) });
  } catch (err) { return next(err); }
}

// GET /api/services/catalogue  (B2B + Online tiles)
// A tile whose service is in Service Master shows only when the user may use it
// (service on + Service Permissions). Fund Request is always shown (it is also in the sidebar).
async function catalogue(req, res, next) {
  try {
  const b2b = [
    ['mobile-recharge', 'Mobile Recharge', 'phone'], ['dth-recharge', 'DTH Recharge', 'phone'],
    ['bill-payment', 'Bill Payment', 'receipt'], ['aeps', 'AEPS', 'verify'],
    ['money-transfer', 'Money Transfer', 'transfer'], ['move-to-bank', 'Move To Bank', 'bank'],
    ['fund-request', 'Fund Request', 'fund'], ['aadhar-pay', 'Aadhar Pay', 'verify'],
    ['micro-atm', 'Micro ATM', 'atm'], ['fund-transfer', 'Fund Transfer', 'transfer'],
    ['fastag', 'FASTag', 'cash'], ['upi-collection', 'UPI Collection', 'wallet'],
    ['fino-cms', 'Fino CMS', 'cash'], ['lic-payment', 'LIC Payment', 'receipt'],
    ['nsdl-pan', 'NSDL PAN Card', 'users'], ['gas-booking', 'Gas Booking', 'cash'],
  ].map(([key, title, icon]) => ({ key, title, icon, route: `/services/${key}` }));
  const online = [
    ['flight', 'Flight Booking', 'send'], ['hotel', 'Hotel Booking', 'grid'], ['bus', 'Bus Booking', 'transfer'],
  ].map(([key, title, icon]) => ({ key, title, icon, route: `/services/${key}` }));
  const allowed = await permission.allowedServiceIds(req.user.id);
  const visible = async (tiles) => {
    const out = [];
    for (const t of tiles) {
      // eslint-disable-next-line no-await-in-loop
      if (t.key === 'fund-request' || serviceGuard.allowedFor(await serviceGuard.findService(t.title), allowed)) out.push(t);
    }
    return out;
  };
  return res.json({ b2b: await visible(b2b), online: await visible(online) });
  } catch (e) { return next(e); }
}

// GET /api/operators?service=mobile&category=Electricity
async function operators(req, res, next) {
  try {
    const service = clean(req.query.service);
    const category = clean(req.query.category);
    const q = db('operators').where({ is_active: true });
    if (service) q.where({ service });
    if (category) q.where({ category });
    const rows = await q.orderBy('name', 'asc').select('id', 'name', 'category', 'service', 'circle_required');
    return res.json({ rows });
  } catch (err) { return next(err); }
}

async function accountHistory(req, res, next) {
  try { const f = ownerFilters(req); const r = await reportsRepo.accountTransactions(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
async function serviceReport(req, res, next) {
  try { const f = ownerFilters(req); const r = await reportsRepo.serviceTransactions(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
async function gstReport(req, res, next) {
  try { const f = ownerFilters(req); const r = await reportsRepo.commissionLedger(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
async function tdsReport(req, res, next) {
  try { const f = ownerFilters(req); const r = await reportsRepo.commissionLedger(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
async function commissionReport(req, res, next) {
  try { const f = ownerFilters(req); const r = await reportsRepo.commissionLedger(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}

// GET /api/retailer/my-commission-slab  (read-only, this user's type, services that are ON)
async function myCommissionSlab(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    // Every slab of my type for services that are ON. Not limited by my own Service Permissions:
    // a distributor earns chain commission on its downline's transactions without using the service.
    const { rows, total } = await commissionSlotRepo.slab({ userTypeId: req.user.userTypeId, serviceId: null, activeServicesOnly: true, page, pageSize });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

module.exports = { summary, serviceStats, catalogue, operators, accountHistory, serviceReport, gstReport, tdsReport, commissionReport, myCommissionSlab };
