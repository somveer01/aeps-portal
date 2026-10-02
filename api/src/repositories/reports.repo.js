'use strict';

const db = require('../config/db');
const { downlineIds } = require('./network.repo');
const { applyGridFilters, applyGridSort, DATE_TEXT } = require('../utils/gridQuery');

// Common date + user filters (query aliased `x`, joined to users `u`).
function applyCommon(qb, { startDate, endDate, userTypeId, userId }) {
  if (startDate) qb.whereRaw('x.created_at::date >= ?', [startDate]);
  if (endDate) qb.whereRaw('x.created_at::date <= ?', [endDate]);
  if (userTypeId) qb.where('u.user_type_id', userTypeId);
  if (userId) qb.where('x.user_id', userId);
}

// joinsFn() returns the FROM+JOIN query (no select); cols are the select columns.
// grid = parseGrid(query, <REPORT>_GRID): column sort + filters over the whole result.
async function paginate(joinsFn, cols, filterFn, { page = 1, pageSize = 10, grid = null }) {
  const where = (qb) => { qb.where(filterFn); applyGridFilters(qb, grid); };
  const countRow = await joinsFn().where(where).count('x.id as c').first();
  const q = joinsFn().where(where).select(...cols);
  applyGridSort(q, grid, 'x.id', 'desc');
  const rows = await q.limit(pageSize).offset((page - 1) * pageSize);
  return { rows, total: Number(countRow.c) };
}

// Sortable / filterable columns of each report grid (keys = the app's DataGrid column keys).
const USER_TEXT = "concat_ws(' ', u.full_name, u.user_code, u.mobile, u.shop_name)";
const DATE_COL = (col) => ({ sort: col, filter: DATE_TEXT(col) });
const ACCOUNT_GRID = {
  service_name: 'x.service_name', type: 'x.type', remark: 'x.remark', amount: 'x.amount',
  before_balance: 'x.before_balance', updated_balance: 'x.updated_balance',
  user: { sort: 'u.full_name', filter: USER_TEXT }, created_at: DATE_COL('x.created_at'),
};
const SERVICE_GRID = {
  service: 'x.service', operator: 'x.operator', target: 'x.target', amount: 'x.amount', reference_id: 'x.reference_id',
  status: 'x.status', response: 'x.response', user: { sort: 'u.full_name', filter: USER_TEXT }, created_at: DATE_COL('x.created_at'),
};
const FUND_REQUEST_GRID = {
  bank: { sort: 'cb.bank_name', filter: "concat_ws(' ', cb.bank_name, cb.account_no)" },
  deposit_date: { sort: 'x.deposit_date', filter: "to_char(x.deposit_date, 'DD Mon YYYY YYYY-MM-DD')" },
  payment_mode: 'x.payment_mode', amount: 'x.amount', receipt_no: 'x.receipt_no', request_id: 'x.request_id', status: 'x.status',
  remark: 'x.remark', admin_remark: 'x.admin_remark', user: { sort: 'u.full_name', filter: USER_TEXT }, outlet: 'u.shop_name',
  approver: { sort: 'ap.user_code', filter: "concat_ws(' ', coalesce(nullif(ap.user_code, ''), ap.username), ap.full_name, case when ap.role = 'admin' or x.approver_id is null then 'admin' end)" },
  created_at: DATE_COL('x.created_at'),
};

const USER_COLS = ['u.full_name as user_name', 'u.mobile as user_mobile', 'u.user_code', 'u.shop_name as outlet_name', 'ut.name as user_type_name'];
const withUser = (table) => () => db(`${table} as x`)
  .join('users as u', 'u.id', 'x.user_id')
  .leftJoin('user_types as ut', 'ut.id', 'u.user_type_id');

const fundRequestJoins = () => withUser('fund_requests')()
  .leftJoin('company_banks as cb', 'cb.id', 'x.company_bank_id')
  .leftJoin('users as ap', 'ap.id', 'x.approver_id');
const FR_COLS = ['x.*', ...USER_COLS, 'cb.bank_name', 'cb.account_no',
  db.raw("coalesce(nullif(ap.user_code, ''), ap.username) as approver_code"), 'ap.full_name as approver_name', 'ap.role as approver_role'];

module.exports = {
  ACCOUNT_GRID, SERVICE_GRID, FUND_REQUEST_GRID,

  accountTransactions(f) {
    return paginate(withUser('account_transactions'), ['x.*', ...USER_COLS],
      (qb) => { applyCommon(qb, f); if (f.service) qb.where('x.service_name', f.service); if (f.type) qb.where('x.type', f.type); }, f);
  },

  // f.downlineOf: only transactions by users below that user (distributor / MD panel).
  serviceTransactions(f) {
    return paginate(withUser('service_transactions'), ['x.*', ...USER_COLS],
      (qb) => { applyCommon(qb, f); if (f.downlineOf) qb.whereIn('x.user_id', downlineIds(f.downlineOf)); if (f.service) qb.where('x.service', f.service); if (f.status) qb.where('x.status', f.status); }, f);
  },

  // f.approverId: requests this user must approve. f.ownerId: one user's own requests.
  fundRequests(f) {
    return paginate(fundRequestJoins, FR_COLS,
      (qb) => {
        applyCommon(qb, f);
        if (f.status) qb.where('x.status', f.status);
        if (f.approverId) qb.where('x.approver_id', f.approverId);
        if (f.ownerId) qb.where('x.user_id', f.ownerId);
      }, f);
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

  fundRequestById(id) { return fundRequestJoins().select(FR_COLS).where('x.id', id).first(); },
  updateFundRequest(id, patch) { return db('fund_requests').where({ id }).update({ ...patch, updated_at: db.fn.now() }); },
};
