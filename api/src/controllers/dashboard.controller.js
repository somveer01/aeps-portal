'use strict';

const db = require('../config/db');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const num = (v) => Number(v || 0);
const MAX_TREND_DAYS = 92;
// Services whose successful amount counts as money paid out of the platform (bank transfers).
const PAYOUT_SERVICES = ['%money transfer%', '%move to bank%', '%dmt%'];

// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD for the range block. Returns { from, to } (either may be null) or { error }.
function parseRange(q) {
  const from = String(q.from || '').trim() || null;
  const to = String(q.to || '').trim() || null;
  if ((from && !validDate(from)) || (to && !validDate(to))) return { error: 'Dates must look like 2026-01-31' };
  if (from && to && from > to) return { error: 'The start date is after the end date' };
  return { from, to };
}

// Sales trend: successful amount per day over the range (at most 92 days, ending at "to"); no range = the last 14 days.
// `scope(qb)` narrows service_transactions (a user or a downline); the admin passes nothing.
async function salesTrendFor({ from, to }, scope) {
  const end = to ? new Date(`${to}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  let start = from ? new Date(`${from}T00:00:00Z`) : new Date(end.getTime() - 13 * 86400000);
  if ((end - start) / 86400000 + 1 > MAX_TREND_DAYS) start = new Date(end.getTime() - (MAX_TREND_DAYS - 1) * 86400000);
  const s = start.toISOString().slice(0, 10); const e = end.toISOString().slice(0, 10);
  const q = db('service_transactions').where('status', 'success');
  if (scope) scope(q);
  const days = await q.whereRaw('created_at::date >= ?', [s]).whereRaw('created_at::date <= ?', [e])
    .groupByRaw('created_at::date')
    .select(db.raw("to_char(created_at::date, 'YYYY-MM-DD') as d"), db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'));
  const byDay = Object.fromEntries(days.map((r) => [r.d, r]));
  const out = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push({ date: key, count: byDay[key] ? byDay[key].cnt : 0, amount: byDay[key] ? num(byDay[key].amt) : 0 });
  }
  return out;
}

// Everything the "Modern" dashboard shows for a date range (no range = all time; the chart then shows the last 14 days).
// Success / pending / failed come from service_transactions, a refund is a wallet credit the pipeline wrote for a failed service,
// commission in = what the company earned (provider commission + charges), out = commission paid to users, net = margin,
// pay in = approved fund requests, pay out = money sent to banks (money transfer / move to bank).
async function rangeStats({ from, to }) {
  const between = (qb, col) => {
    if (from) qb.whereRaw(`${col}::date >= ?`, [from]);
    if (to) qb.whereRaw(`${col}::date <= ?`, [to]);
    return qb;
  };

  const statusRows = await between(db('service_transactions'), 'created_at')
    .groupBy('status').select('status', db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'));
  const pick = (s) => { const r = statusRows.find((x) => x.status === s); return { count: r ? r.cnt : 0, amount: r ? num(r.amt) : 0 }; };
  const refund = await between(db('account_transactions').where('type', 'credit').andWhere('remark', 'ilike', 'Refund%'), 'created_at')
    .first(db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'));

  const m = await between(db('admin_margins'), 'created_at').first(
    db.raw('COALESCE(sum(provider_commission), 0) as provider'), db.raw('COALESCE(sum(charges_collected), 0) as charges'),
    db.raw('COALESCE(sum(commission_paid), 0) as paid'), db.raw('COALESCE(sum(margin), 0) as margin'),
  );

  const payIn = await between(db('fund_requests').where('status', 'approved'), 'COALESCE(acted_at, updated_at)')
    .first(db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'));
  const payOut = await between(db('service_transactions').where('status', 'success')
    .andWhere((w) => PAYOUT_SERVICES.forEach((p) => w.orWhere('service', 'ilike', p))), 'created_at')
    .first(db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'));

  const topServices = await between(db('service_transactions').where('status', 'success'), 'created_at')
    .groupBy('service').orderByRaw('sum(amount) desc').limit(5)
    .select('service', db.raw('count(*)::int as count'), db.raw('COALESCE(sum(amount), 0) as amount'));

  const salesTrend = await salesTrendFor({ from, to });

  const success = pick('success');
  return {
    from, to,
    statusBreakdown: { success, pending: pick('pending'), failed: pick('failed'), refund: { count: refund.cnt, amount: num(refund.amt) } },
    commission: { in: num(m.provider) + num(m.charges), out: num(m.paid), net: num(m.margin) },
    payIn: { count: payIn.cnt, amount: num(payIn.amt) },
    payOut: { count: payOut.cnt, amount: num(payOut.amt) },
    salesTrend, salesTotal: success.amount,
    topServices: topServices.map((r) => ({ service: r.service, count: r.count, amount: num(r.amount) })),
  };
}

// GET /api/admin/dashboard[?from=&to=] -> business summary for the admin dashboard (+ `range` for the Modern layout).
async function adminSummary(req, res, next) {
  try {
    const adminId = req.user.id;
    const rng = parseRange(req.query || {});
    if (rng.error) return res.status(400).json({ error: rng.error, code: 'INVALID_DATE' });

    // Managed users (user_type_id NOT NULL = retailers/distributors/employees).
    const users = await db('users').whereNotNull('user_type_id').first(
      db.raw('count(*)::int as total'),
      db.raw('count(*) FILTER (WHERE is_active)::int as active'),
      db.raw("count(*) FILTER (WHERE kyc_status = 'pending')::int as pending_kyc"),
      db.raw('COALESCE(sum(wallet_balance), 0) as wallet_total'),
    );
    const byType = await db('users as u').whereNotNull('u.user_type_id')
      .join('user_types as ut', 'ut.id', 'u.user_type_id')
      .groupBy('ut.name').orderBy('ut.name')
      .select('ut.name', db.raw('count(*)::int as count'));

    const admin = await db('users').where({ id: adminId }).first('wallet_balance');

    // Transaction volume (service_transactions).
    const txnAgg = (whereRaw) => {
      const q = db('service_transactions');
      if (whereRaw) q.whereRaw(whereRaw);
      return q.first(
        db.raw('count(*)::int as cnt'),
        db.raw('COALESCE(sum(amount), 0) as amt'),
        db.raw("count(*) FILTER (WHERE status = 'success')::int as success"),
      );
    };
    const txToday = await txnAgg('created_at::date = CURRENT_DATE');
    const txMonth = await txnAgg("date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)");
    const txTotal = await txnAgg(null);

    // Admin commission / profit (admin_margins.margin).
    const commAgg = (whereRaw) => {
      const q = db('admin_margins');
      if (whereRaw) q.whereRaw(whereRaw);
      return q.first(
        db.raw('COALESCE(sum(margin), 0) as margin'),
        db.raw('COALESCE(sum(charges_collected), 0) as charges'),
        db.raw('COALESCE(sum(commission_paid), 0) as paid'),
      );
    };
    const commToday = await commAgg('created_at::date = CURRENT_DATE');
    const commMonth = await commAgg("date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)");
    const commTotal = await commAgg(null);

    const fr = await db('fund_requests').where({ status: 'pending' }).first(
      db.raw('count(*)::int as cnt'),
      db.raw('COALESCE(sum(amount), 0) as amt'),
    );

    const svc = await db('services').first(
      db.raw('count(*)::int as total'),
      db.raw('count(*) FILTER (WHERE is_active)::int as active'),
    );

    const recent = await db('service_transactions as t')
      .leftJoin('users as u', 'u.id', 't.user_id')
      .orderBy('t.created_at', 'desc').limit(6)
      .select('t.id', 't.service', 't.amount', 't.status', 't.created_at',
        'u.full_name as user_name', 'u.user_code');

    // Last-7-days trend (transactions + commission).
    const txDays = await db('service_transactions')
      .whereRaw("created_at >= CURRENT_DATE - INTERVAL '6 days'")
      .groupByRaw('created_at::date')
      .select(db.raw("to_char(created_at::date, 'YYYY-MM-DD') as d"),
        db.raw('count(*)::int as cnt'), db.raw('COALESCE(sum(amount), 0) as amt'));
    const commDays = await db('admin_margins')
      .whereRaw("created_at >= CURRENT_DATE - INTERVAL '6 days'")
      .groupByRaw('created_at::date')
      .select(db.raw("to_char(created_at::date, 'YYYY-MM-DD') as d"),
        db.raw('COALESCE(sum(margin), 0) as margin'));
    const txMap = Object.fromEntries(txDays.map((r) => [r.d, r]));
    const cmMap = Object.fromEntries(commDays.map((r) => [r.d, r]));
    const trend7 = [];
    for (let i = 6; i >= 0; i -= 1) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const key = dt.toISOString().slice(0, 10);
      trend7.push({
        date: key,
        count: txMap[key] ? txMap[key].cnt : 0,
        amount: txMap[key] ? Number(txMap[key].amt) : 0,
        commission: cmMap[key] ? Number(cmMap[key].margin) : 0,
      });
    }

    // Service-wise breakdown (volume + commission), top 8 by amount.
    const byService = await db('service_transactions as t')
      .leftJoin('admin_margins as m', 'm.service_transaction_id', 't.id')
      .groupBy('t.service').orderByRaw('sum(t.amount) desc').limit(8)
      .select('t.service', db.raw('count(DISTINCT t.id)::int as cnt'),
        db.raw('COALESCE(sum(t.amount), 0) as amt'), db.raw('COALESCE(sum(m.margin), 0) as commission'));

    // Action items the admin should clear.
    const pendingKycSub = await db('kyc_submissions').where({ status: 'pending' }).count('id as c').first();
    const pendingTxns = await db('service_transactions').whereNot({ status: 'success' }).count('id as c').first();
    const openTickets = await db('tickets').whereIn('status', ['open', 'pending', 'in_progress']).count('id as c').first();

    const range = await rangeStats(rng);

    return res.json({
      range,
      users: {
        total: users.total,
        active: users.active,
        inactive: users.total - users.active,
        pendingKyc: users.pending_kyc,
        walletTotal: Number(users.wallet_total),
        byType,
      },
      adminWallet: Number(admin ? admin.wallet_balance : 0),
      transactions: {
        today: { count: txToday.cnt, amount: Number(txToday.amt), success: txToday.success },
        month: { count: txMonth.cnt, amount: Number(txMonth.amt) },
        total: { count: txTotal.cnt, amount: Number(txTotal.amt) },
      },
      commission: {
        today: Number(commToday.margin),
        month: Number(commMonth.margin),
        total: Number(commTotal.margin),
        chargesMonth: Number(commMonth.charges),
        paidMonth: Number(commMonth.paid),
      },
      fundRequests: { pending: fr.cnt, amount: Number(fr.amt) },
      services: { active: svc.active, total: svc.total },
      recent,
      trend7,
      byService,
      actions: {
        fundRequests: fr.cnt,
        kyc: Number(pendingKycSub ? pendingKycSub.c : 0),
        pendingTxns: Number(pendingTxns ? pendingTxns.c : 0),
        tickets: Number(openTickets ? openTickets.c : 0),
      },
    });
  } catch (err) { return next(err); }
}

module.exports = { adminSummary, parseRange, salesTrendFor };
