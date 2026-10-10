'use strict';

const { parseGrid } = require('../utils/gridQuery');
const db = require('../config/db');
const serviceGuard = require('../services/serviceGuard.service');
const permission = require('../services/servicePermission.service');
const reportsRepo = require('../repositories/reports.repo');
const commissionSlotRepo = require('../repositories/commissionSlot.repo');
const networkRepo = require('../repositories/network.repo');
const dashboardCtl = require('./dashboard.controller');

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
    const commToday = await db('commission_ledger').where({ user_id: req.user.id, wallet_txn_type: 'credit' }) // earned, not service charges
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

// Services whose successful amount counts as money sent to a bank (same rule as the admin dashboard).
const PAYOUT_SERVICES = ['%money transfer%', '%move to bank%', '%dmt%'];

// GET /api/retailer/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD  (Modern dashboard of every managed user)
// Same blocks as the admin `range`, but strictly the caller's own data: own service transactions, own wallet refunds, commission the
// caller earned (level 0 = own business, level > 0 = from the downline), approved fund requests the caller received, money the caller sent
// to banks. Types that may have a downline also get `network` (the whole downline's successful volume, commission earned from it, head count).
async function dashboard(req, res, next) {
  try {
    const rng = dashboardCtl.parseRange(req.query || {});
    if (rng.error) return res.status(400).json({ error: rng.error, code: 'INVALID_DATE' });
    const { from, to } = rng;
    const me = req.user.id;
    const num = (v) => Number(v || 0);
    const between = (qb, col) => {
      if (from) qb.whereRaw(`${col}::date >= ?`, [from]);
      if (to) qb.whereRaw(`${col}::date <= ?`, [to]);
      return qb;
    };
    const sum = (col) => db.raw(`COALESCE(sum(${col}), 0) as amt`);
    const cnt = db.raw('count(*)::int as cnt');

    const statusRows = await between(db('service_transactions').where('user_id', me), 'created_at')
      .groupBy('status').select('status', cnt, sum('amount'));
    const pick = (s) => { const r = statusRows.find((x) => x.status === s); return { count: r ? r.cnt : 0, amount: r ? num(r.amt) : 0 }; };
    const refund = await between(db('account_transactions').where({ user_id: me, type: 'credit' }).andWhere('remark', 'ilike', 'Refund%'), 'created_at')
      .first(cnt, sum('amount'));

    const earned = (level) => between(db('commission_ledger').where({ user_id: me, wallet_txn_type: 'credit' })
      .modify((q) => (level === 0 ? q.where('level', 0) : q.where('level', '>', 0))), 'created_at').first(sum('net_amount'));
    const own = num((await earned(0)).amt);
    const fromNetwork = num((await earned(1)).amt);

    const payIn = await between(db('fund_requests').where({ user_id: me, status: 'approved' }), 'COALESCE(acted_at, updated_at)').first(cnt, sum('amount'));
    const payOut = await between(db('service_transactions').where({ user_id: me, status: 'success' })
      .andWhere((w) => PAYOUT_SERVICES.forEach((p) => w.orWhere('service', 'ilike', p))), 'created_at').first(cnt, sum('amount'));
    const topServices = await between(db('service_transactions').where({ user_id: me, status: 'success' }), 'created_at')
      .groupBy('service').orderByRaw('sum(amount) desc').limit(5).select('service', db.raw('count(*)::int as count'), db.raw('COALESCE(sum(amount), 0) as amount'));
    const salesTrend = await dashboardCtl.salesTrendFor({ from, to }, (q) => q.where('user_id', me));

    let network = null;
    if (await networkRepo.canHaveDownline(req.user.userTypeId)) {
      const ids = networkRepo.downlineIds(me);
      const vol = await between(db('service_transactions').whereIn('user_id', ids).where('status', 'success'), 'created_at').first(cnt, sum('amount'));
      const heads = await db('users').whereIn('id', ids).first(db.raw('count(*)::int as total'), db.raw('count(*) FILTER (WHERE is_active)::int as active'));
      network = { volume: { count: vol.cnt, amount: num(vol.amt) }, commission: fromNetwork, users: { total: heads.total, active: heads.active } };
    }

    const success = pick('success');
    return res.json({
      from, to,
      statusBreakdown: { success, pending: pick('pending'), failed: pick('failed'), refund: { count: refund.cnt, amount: num(refund.amt) } },
      commission: { own, network: fromNetwork, total: own + fromNetwork },
      payIn: { count: payIn.cnt, amount: num(payIn.amt) },
      payOut: { count: payOut.cnt, amount: num(payOut.amt) },
      salesTrend, salesTotal: success.amount,
      topServices: topServices.map((r) => ({ service: r.service, count: r.count, amount: num(r.amount) })),
      network,
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
  try { const f = { ...ownerFilters(req), grid: parseGrid(req.query, reportsRepo.ACCOUNT_GRID) }; const r = await reportsRepo.accountTransactions(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
async function serviceReport(req, res, next) {
  try { const f = { ...ownerFilters(req), grid: parseGrid(req.query, reportsRepo.SERVICE_GRID) }; const r = await reportsRepo.serviceTransactions(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
async function gstReport(req, res, next) {
  try { const f = { ...ownerFilters(req), grid: parseGrid(req.query, reportsRepo.COMMISSION_GRID) }; const r = await reportsRepo.commissionLedger(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
async function tdsReport(req, res, next) {
  try { const f = { ...ownerFilters(req), grid: parseGrid(req.query, reportsRepo.COMMISSION_GRID) }; const r = await reportsRepo.commissionLedger(f); return res.json({ ...r, page: f.page, pageSize: f.pageSize }); } catch (e) { return next(e); }
}
// Level filter from the query: 'own' = 0, 'downline' = anything below me, or a level number.
function levelFilter(v) {
  const s = clean(v).toLowerCase();
  if (s === 'own') return { level: 0 };
  if (s === 'downline') return { fromDownline: true };
  return /^\d{1,2}$/.test(s) ? { level: parseInt(s, 10) } : {};
}

// GET /api/retailer/commission-report — what I earned (own + from my whole downline), with the
// downline user, level and direct-child branch of every row, filters and totals. sourceUserId /
// branchChildId must be in my own downline (branchChildId: a direct child).
async function commissionReport(req, res, next) {
  try {
    const me = req.user.id;
    const sourceUserId = parseInt(req.query.sourceUserId, 10) || null;
    const branchChildId = parseInt(req.query.branchChildId, 10) || null;
    if (sourceUserId && sourceUserId !== me && !(await networkRepo.levelOf(me, sourceUserId))) return res.status(404).json({ error: 'User is not in your network', code: 'NOT_IN_NETWORK' });
    if (branchChildId && (await networkRepo.levelOf(me, branchChildId)) !== 1) return res.status(404).json({ error: 'Not one of your direct users', code: 'NOT_IN_NETWORK' });
    const f = {
      ...ownerFilters(req), ...levelFilter(req.query.level), sourceUserId, branchChildId,
      txnType: ['credit', 'debit'].includes(req.query.type) ? req.query.type : null, viaFor: me,
      grid: parseGrid(req.query, reportsRepo.COMMISSION_GRID),
    };
    const r = await reportsRepo.commissionLedger(f);
    return res.json({ ...r, page: f.page, pageSize: f.pageSize });
  } catch (e) { return next(e); }
}

// GET /api/retailer/commission-summary?startDate&endDate — own vs downline commission, and how
// much came through each direct child (empty for a retailer, who has no one below).
async function commissionSummary(req, res, next) {
  try {
    const { startDate, endDate } = ownerFilters(req);
    const q = db('commission_ledger').where({ user_id: req.user.id });
    if (startDate) q.whereRaw('created_at::date >= ?', [startDate]);
    if (endDate) q.whereRaw('created_at::date <= ?', [endDate]);
    const t = await q.first(
      db.raw("coalesce(sum(net_amount) filter (where wallet_txn_type = 'credit' and level = 0), 0) as own"),
      db.raw("coalesce(sum(net_amount) filter (where wallet_txn_type = 'credit' and level > 0), 0) as from_downline"),
      db.raw("count(*) filter (where wallet_txn_type = 'credit' and level > 0)::int as downline_txns"),
      db.raw("coalesce(sum(net_amount) filter (where wallet_txn_type = 'debit'), 0) as charges"),
    );
    const byChild = await reportsRepo.commissionByChild(req.user.id, { startDate, endDate });
    return res.json({ own: Number(t.own), fromDownline: Number(t.from_downline), downlineTxns: t.downline_txns, charges: Number(t.charges), byChild });
  } catch (e) { return next(e); }
}

// GET /api/retailer/my-commission-slab  (read-only, this user's type, services that are ON)
async function myCommissionSlab(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    // Every slab of my type for services that are ON. Not limited by my own Service Permissions:
    // a distributor earns chain commission on its downline's transactions without using the service.
    const { rows, total } = await commissionSlotRepo.slab({ userTypeId: req.user.userTypeId, serviceId: null, activeServicesOnly: true, grid: parseGrid(req.query, commissionSlotRepo.GRID), page, pageSize });
    // A commission package from my direct parent replaces the admin rate on credit slabs
    // (the engine still caps it at what my parent earns).
    const me = await db('users').where({ id: req.user.id }).first('parent_id', 'user_type_id', 'commission_package_id');
    const pkg = me && me.commission_package_id ? await db('commission_packages')
      .where({ id: me.commission_package_id, owner_user_id: me.parent_id, user_type_id: me.user_type_id, is_active: true }).first('id', 'name') : null;
    const items = pkg ? await db('commission_package_items').where({ package_id: pkg.id }).select('service_id', 'operator', 'commission_type', 'value') : [];
    const op = (v) => String(v || '').trim().toLowerCase();
    const out = rows.map((r) => {
      if (!pkg || r.txn_type === 'debit' || String(r.specific_user || '').trim()) return r;
      const mine = items.filter((i) => i.service_id === r.service_id);
      const item = mine.find((i) => op(i.operator) && op(i.operator) === op(r.operator)) || mine.find((i) => !op(i.operator));
      if (!item) return r;
      return { ...r, package_name: pkg.name, default_commission_type: r.commission_type, default_value: r.value, commission_type: item.commission_type, value: item.value };
    });
    return res.json({ rows: out, total, page, pageSize, packageName: pkg ? pkg.name : null });
  } catch (err) { return next(err); }
}

module.exports = { summary, dashboard, serviceStats, catalogue, operators, accountHistory, serviceReport, gstReport, tdsReport, commissionReport, commissionSummary, myCommissionSlab };
