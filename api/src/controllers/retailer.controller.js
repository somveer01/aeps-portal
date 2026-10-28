'use strict';

const { parseGrid } = require('../utils/gridQuery');
const db = require('../config/db');
const permission = require('../services/servicePermission.service');
const retailerScreens = require('../services/retailerScreens');
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

// GET /api/services/catalogue  (B2B + Online tiles) - built from SERVICE MASTER: every switched-on service that has a Retailer screen
// (services.screen, see services/retailerScreens.js) the user may use (Service Permissions). The title comes from the Master, the icon and
// the tab from the screen. The main service of a screen (code = screen key) opens /services/<screen>; any further service on the same
// screen adds ?service=<code>. Fund Request is always shown (it is also in the sidebar).
async function catalogue(req, res, next) {
  try {
    const allowed = await permission.allowedServiceIds(req.user.id);
    const rows = await db('services').where({ is_active: true }).whereNotNull('screen').where('screen', '<>', '').orderBy('id').select('id', 'title', 'code', 'screen');
    const out = { b2b: [], online: [] };
    rows.forEach((s) => {
      const sc = retailerScreens.SCREENS[s.screen];
      if (!sc || !allowed.has(s.id)) return;
      const main = !s.code || s.code === s.screen;
      out[sc.group].push({
        key: s.code || `s${s.id}`, title: s.title, icon: sc.icon, screen: s.screen, service: s.code || null,
        route: `/services/${s.screen}${main ? '' : `?service=${s.code}`}`,
      });
    });
    out.b2b.push({ key: 'fund-request', title: 'Fund Request', icon: 'fund', screen: 'fund-request', service: null, route: '/services/fund-request' });
    return res.json(out);
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
// GET /api/retailer/report-services — the services that appear in MY reports (own transactions, wallet history, commission earned),
// for the "Service" filter of the Service / Commission / GST / TDS / history reports. Only the caller's own rows.
async function reportServices(req, res, next) {
  try {
    const me = req.user.id;
    const { rows } = await db.raw(
      `SELECT DISTINCT name FROM (
         SELECT service AS name FROM service_transactions WHERE user_id = ?
         UNION SELECT service_name FROM commission_ledger WHERE user_id = ?
         UNION SELECT service_name FROM account_transactions WHERE user_id = ?) s
       WHERE name IS NOT NULL AND name <> '' ORDER BY name`, [me, me, me],
    );
    return res.json({ rows: rows.map((r) => r.name) });
  } catch (e) { return next(e); }
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
    const me = await db('users').where({ id: req.user.id }).first('parent_id', 'user_type_id', 'commission_package_id', 'plan_id', 'user_code', 'username');
    // The slabs that really apply to ME for services that are ON: of my plan, switched on, the type's slabs plus the ones written for me (never
    // another user's), and my own slab instead of the type's where it covers it. Not limited by my own Service Permissions:
    // a distributor earns chain commission on its downline's transactions without using the service.
    const forUser = { planId: me && me.plan_id, userCode: me && (me.user_code || me.username) };
    const { rows, total } = await commissionSlotRepo.slab({ userTypeId: req.user.userTypeId, serviceId: null, activeServicesOnly: true, forUser, grid: parseGrid(req.query, commissionSlotRepo.GRID), page, pageSize });
    // A commission package from my direct parent replaces the admin rate on credit slabs
    // (the engine still caps it at what my parent earns).
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

module.exports = { summary, dashboard, reportServices, serviceStats, catalogue, operators, accountHistory, serviceReport, gstReport, tdsReport, commissionReport, commissionSummary, myCommissionSlab };
