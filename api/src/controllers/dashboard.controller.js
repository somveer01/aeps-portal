'use strict';

const db = require('../config/db');

// GET /api/admin/dashboard -> business summary for the admin dashboard.
async function adminSummary(req, res, next) {
  try {
    const adminId = req.user.id;

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

    return res.json({
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

module.exports = { adminSummary };
