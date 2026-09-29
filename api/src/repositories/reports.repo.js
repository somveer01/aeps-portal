'use strict';

const db = require('../config/db');

// Common date + user filters (query aliased `x`, joined to users `u`).
function applyCommon(qb, { startDate, endDate, userTypeId, userId }) {
  if (startDate) qb.whereRaw('x.created_at::date >= ?', [startDate]);
  if (endDate) qb.whereRaw('x.created_at::date <= ?', [endDate]);
  if (userTypeId) qb.where('u.user_type_id', userTypeId);
  if (userId) qb.where('x.user_id', userId);
}

// joinsFn() returns the FROM+JOIN query (no select); cols are the select columns.
async function paginate(joinsFn, cols, filterFn, { page = 1, pageSize = 10 }) {
  const countRow = await joinsFn().where(filterFn).count('x.id as c').first();
  const rows = await joinsFn().where(filterFn).select(...cols).orderBy('x.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
  return { rows, total: Number(countRow.c) };
}

const USER_COLS = ['u.full_name as user_name', 'u.mobile as user_mobile', 'u.user_code', 'u.shop_name as outlet_name', 'ut.name as user_type_name'];
const withUser = (table) => () => db(`${table} as x`)
  .join('users as u', 'u.id', 'x.user_id')
  .leftJoin('user_types as ut', 'ut.id', 'u.user_type_id');

module.exports = {
  accountTransactions(f) {
    return paginate(withUser('account_transactions'), ['x.*', ...USER_COLS],
      (qb) => { applyCommon(qb, f); if (f.service) qb.where('x.service_name', f.service); if (f.type) qb.where('x.type', f.type); }, f);
  },

  serviceTransactions(f) {
    return paginate(withUser('service_transactions'), ['x.*', ...USER_COLS],
      (qb) => { applyCommon(qb, f); if (f.service) qb.where('x.service', f.service); if (f.status) qb.where('x.status', f.status); }, f);
  },

  fundRequests(f) {
    const joins = () => withUser('fund_requests')().leftJoin('company_banks as cb', 'cb.id', 'x.company_bank_id');
    return paginate(joins, ['x.*', ...USER_COLS, 'cb.bank_name', 'cb.account_no'],
      (qb) => { applyCommon(qb, f); if (f.status) qb.where('x.status', f.status); }, f);
  },

  // Commission ledger with GST + TDS breakdown. Backs both the GST Report and
  // TDS Report (same rows; each screen surfaces its own tax columns).
  commissionLedger(f) {
    const joins = () => withUser('commission_ledger')().leftJoin('users as su', 'su.id', 'x.source_user_id');
    return paginate(joins, ['x.*', ...USER_COLS, db.raw("coalesce(nullif(su.user_code, ''), su.username) as source_user_code"), 'su.full_name as source_user_name'],
      (qb) => { applyCommon(qb, f); if (f.service) qb.where('x.service_name', f.service); }, f);
  },

  // Admin margin per successful transaction, plus totals over the whole filter.
  async adminMargins(f) {
    const filter = (qb) => { applyCommon(qb, f); if (f.service) qb.where('x.service_name', f.service); };
    const page = await paginate(withUser('admin_margins'), ['x.*', ...USER_COLS], filter, f);
    const t = await withUser('admin_margins')().where(filter)
      .sum({ amount: 'x.amount', provider_commission: 'x.provider_commission', charges_collected: 'x.charges_collected', commission_paid: 'x.commission_paid', margin: 'x.margin' })
      .first();
    const totals = Object.fromEntries(Object.entries(t || {}).map(([k, v]) => [k, Number(v || 0)]));
    return { ...page, totals };
  },

  fundRequestById(id) {
    return withUser('fund_requests')()
      .leftJoin('company_banks as cb', 'cb.id', 'x.company_bank_id')
      .select('x.*', ...USER_COLS, 'cb.bank_name', 'cb.account_no').where('x.id', id).first();
  },
  updateFundRequest(id, patch) { return db('fund_requests').where({ id }).update({ ...patch, updated_at: db.fn.now() }); },
};
