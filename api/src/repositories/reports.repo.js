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

const COMMISSION_GRID = {
  service_name: 'x.service_name', slot_type: 'x.slot_type', type_value: 'x.type_value', type_value_amount: 'x.type_value_amount',
  gst_percent: 'x.gst_percent', gst_amount: 'x.gst_amount', tds_percent: 'x.tds_percent', tds_amount: 'x.tds_amount',
  net_amount: 'x.net_amount', wallet_txn_type: 'x.wallet_txn_type', wallet_txn_amount: 'x.wallet_txn_amount', remark: 'x.remark',
  before_balance: 'x.before_balance', updated_balance: 'x.updated_balance', user: { sort: 'u.full_name', filter: USER_TEXT },
  source: { sort: 'su.user_code', filter: "concat_ws(' ', su.user_code, su.full_name, case when x.level = 0 then 'own transaction' end)" },
  level: { sort: 'x.level', filter: "case when x.level = 0 then 'own 0' else x.level::text end" },
  txn_amount: 'st.amount', operator: { sort: 'st.operator', filter: "concat_ws(' ', st.operator, st.mode)" },
  created_at: DATE_COL('x.created_at'),
};

const LEDGER_COLS = ['x.*', ...USER_COLS, db.raw("coalesce(nullif(su.user_code, ''), su.username) as source_user_code"), 'su.full_name as source_user_name',
  'sut.name as source_user_type', 'st.amount as txn_amount', 'st.operator as txn_operator', 'st.mode as txn_mode'];
const ledgerJoins = () => withUser('commission_ledger')()
  .leftJoin('users as su', 'su.id', 'x.source_user_id')
  .leftJoin('user_types as sut', 'sut.id', 'su.user_type_id')
  .leftJoin('service_transactions as st', 'st.id', 'x.service_transaction_id');

// Ledger filters. level: a number (0 = own transactions); fromDownline: level > 0 only;
// sourceUserId: one downline user's transactions; branchChildId: that direct child and everyone
// below it; txnType: 'credit' (commission earned) or 'debit' (service charge taken).
function ledgerFilter(f) {
  return (qb) => {
    applyCommon(qb, f);
    if (f.service) qb.where('x.service_name', f.service);
    if (Number.isInteger(f.level)) qb.where('x.level', f.level);
    if (f.fromDownline) qb.where('x.level', '>', 0);
    if (f.sourceUserId) qb.where('x.source_user_id', f.sourceUserId);
    if (f.branchChildId) qb.where((w) => w.where('x.source_user_id', f.branchChildId).orWhereIn('x.source_user_id', downlineIds(f.branchChildId)));
    if (f.txnType) qb.where('x.wallet_txn_type', f.txnType);
  };
}

// For each source user, the viewer's DIRECT child whose branch it belongs to (walks up parent_id).
async function viaChildOf(viewerId, sourceIds) {
  const ids = [...new Set(sourceIds.filter((id) => id && id !== viewerId))];
  if (!ids.length) return {};
  const { rows } = await db.raw(
    `WITH RECURSIVE up(start_id, id, parent_id, depth) AS (
       SELECT u.id, u.id, u.parent_id, 0 FROM users u WHERE u.id = ANY(?)
       UNION ALL
       SELECT up.start_id, p.id, p.parent_id, up.depth + 1 FROM up JOIN users p ON p.id = up.parent_id
        WHERE up.parent_id <> ? AND up.depth < 10)
     SELECT up.start_id, c.id AS child_id, coalesce(nullif(c.user_code, ''), c.username) AS child_code, c.full_name AS child_name
       FROM up JOIN users c ON c.id = up.id WHERE up.parent_id = ?`,
    [ids, viewerId, viewerId],
  );
  return Object.fromEntries(rows.map((r) => [r.start_id, r]));
}
const MARGIN_GRID = {
  service_name: 'x.service_name', user: { sort: 'u.full_name', filter: USER_TEXT }, amount: 'x.amount', provider_commission: 'x.provider_commission',
  charges_collected: 'x.charges_collected', commission_paid: 'x.commission_paid', margin: 'x.margin', created_at: DATE_COL('x.created_at'),
  provider: { sort: 'ap.name', filter: "concat_ws(' ', ap.name, ap.code)" }, operator: 'x.operator',
};
// Admin margin rows with the API the transaction went through (API Management; null for older rows).
const marginJoins = () => withUser('admin_margins')().leftJoin('api_providers as ap', 'ap.id', 'x.provider_id');

// ── User Summary: one row per managed user, everything the user did / earned / paid in the date range ──
const USER_SUMMARY_GRID = {
  user: { sort: 'x.user_name', filter: "concat_ws(' ', x.user_name, x.user_code, x.mobile, x.shop_name)" },
  user_type_name: 'x.user_type_name', parent_code: 'x.parent_code', wallet_balance: 'x.wallet_balance',
  txns: 'x.txns', volume: 'x.volume', own_commission: 'x.own_commission', network_commission: 'x.network_commission',
  charges_paid: 'x.charges_paid', refunds: 'x.refunds', wallet_added: 'x.wallet_added', company_margin: 'x.company_margin',
};
const SUMMARY_NUMBERS = ['wallet_balance', 'volume', 'own_commission', 'network_commission', 'charges_paid', 'refunds', 'wallet_added', 'company_margin'];
const SUMMARY_COUNTS = ['txns', 'success', 'failed', 'pending'];
const asNumbers = (row) => {
  const out = { ...row };
  SUMMARY_NUMBERS.forEach((k) => { if (k in out) out[k] = Number(out[k] || 0); });
  SUMMARY_COUNTS.forEach((k) => { if (k in out) out[k] = Number(out[k] || 0); });
  return out;
};

// Date range as SQL pieces. `binds` is filled in the order the pieces appear in the SQL text.
function dateSql(binds, { startDate, endDate }) {
  return (col) => {
    let s = '';
    if (startDate) { s += ` and ${col}::date >= ?`; binds.push(startDate); }
    if (endDate) { s += ` and ${col}::date <= ?`; binds.push(endDate); }
    return s;
  };
}

// The one-row-per-user query as a wrapped sub-select `x`, so the grid can sort / filter its columns.
function userSummarySub({ startDate, endDate, userTypeId, userId }) {
  const binds = [];
  const dates = dateSql(binds, { startDate, endDate });
  const sql = `
    select u.id, u.user_code, u.full_name as user_name, u.mobile, u.shop_name, u.is_active, u.wallet_balance,
           ut.name as user_type_name, par.user_code as parent_code,
           coalesce(t.txns, 0) as txns, coalesce(t.success, 0) as success, coalesce(t.failed, 0) as failed, coalesce(t.pending, 0) as pending, coalesce(t.volume, 0) as volume,
           coalesce(c.own, 0) as own_commission, coalesce(c.network, 0) as network_commission, coalesce(c.charges, 0) as charges_paid,
           coalesce(f.added, 0) as wallet_added, coalesce(r.refunds, 0) as refunds, coalesce(m.margin, 0) as company_margin
      from users u
      left join user_types ut on ut.id = u.user_type_id
      left join users par on par.id = u.parent_id
      left join (select user_id, count(*) as txns, count(*) filter (where status = 'success') as success,
                        count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'pending') as pending,
                        sum(amount) filter (where status = 'success') as volume
                   from service_transactions where true${dates('created_at')} group by user_id) t on t.user_id = u.id
      left join (select user_id,
                        sum(net_amount) filter (where wallet_txn_type = 'credit' and level = 0) as own,
                        sum(net_amount) filter (where wallet_txn_type = 'credit' and level > 0) as network,
                        sum(net_amount) filter (where wallet_txn_type = 'debit') as charges
                   from commission_ledger where true${dates('created_at')} group by user_id) c on c.user_id = u.id
      left join (select user_id, sum(amt) as added from (
                   select user_id, amount as amt, coalesce(acted_at, created_at) as at from fund_requests where status = 'approved'
                   union all
                   select to_user_id, case when transfer_type = 'credit' then amount else -amount end, created_at from fund_transfers where coalesce(status, 'success') = 'success'
                 ) z where true${dates('z.at')} group by user_id) f on f.user_id = u.id
      left join (select user_id, sum(amount) as refunds from account_transactions
                  where type = 'credit' and remark ilike 'Refund%'${dates('created_at')} group by user_id) r on r.user_id = u.id
      left join (select user_id, sum(margin) as margin from admin_margins where true${dates('created_at')} group by user_id) m on m.user_id = u.id
     where u.user_type_id is not null${userTypeId ? ' and u.user_type_id = ?' : ''}${userId ? ' and u.id = ?' : ''}`;
  if (userTypeId) binds.push(userTypeId);
  if (userId) binds.push(userId);
  return db.raw(sql, binds).wrap('(', ') as x');
}

module.exports = {
  ACCOUNT_GRID, SERVICE_GRID, FUND_REQUEST_GRID, COMMISSION_GRID, MARGIN_GRID, USER_SUMMARY_GRID,

  // One row per managed user + totals over the whole filter (grid filters included).
  async userSummary(f) {
    const where = (qb) => applyGridFilters(qb, f.grid);
    const countRow = await db.from(userSummarySub(f)).where(where).count('x.id as c').first();
    const q = db.select('x.*').from(userSummarySub(f)).where(where);
    if (f.grid && f.grid.sort) applyGridSort(q, f.grid, 'x.id', 'asc'); else q.orderByRaw('x.volume desc, x.id asc');
    const rows = (await q.limit(f.pageSize).offset((f.page - 1) * f.pageSize)).map(asNumbers);
    const sums = ['txns', 'success', 'failed', 'pending', 'volume', 'own_commission', 'network_commission', 'charges_paid', 'refunds', 'wallet_added', 'company_margin', 'wallet_balance']
      .map((k) => db.raw(`coalesce(sum(x.${k}), 0) as ${k}`));
    const t = await db.from(userSummarySub(f)).where(where).first(...sums, db.raw('count(*) as users'));
    return { rows, total: Number(countRow.c), totals: asNumbers({ ...t, users: Number(t.users) }) };
  },

  // One user's summary row + the same numbers per service.
  async userSummaryDetail(userId, f) {
    const user = await db.from(userSummarySub({ ...f, userId, userTypeId: null })).select('x.*').first();
    if (!user) return null;
    const dates = dateSql([], f); // only the SQL pieces are used here; the binds are listed explicitly below
    const sql = `
      with t as (select service, count(*) as txns, count(*) filter (where status = 'success') as success,
                        count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'pending') as pending,
                        sum(amount) filter (where status = 'success') as volume
                   from service_transactions where user_id = ?${dates('created_at')} group by service),
           c as (select service_name as service,
                        sum(net_amount) filter (where wallet_txn_type = 'credit' and level = 0) as own,
                        sum(net_amount) filter (where wallet_txn_type = 'credit' and level > 0) as network,
                        sum(net_amount) filter (where wallet_txn_type = 'debit') as charges
                   from commission_ledger where user_id = ?${dates('created_at')} group by service_name),
           m as (select service_name as service, sum(margin) as margin from admin_margins where user_id = ?${dates('created_at')} group by service_name),
           names as (select service from t union select service from c union select service from m)
      select n.service, coalesce(t.txns, 0) as txns, coalesce(t.success, 0) as success, coalesce(t.failed, 0) as failed, coalesce(t.pending, 0) as pending,
             coalesce(t.volume, 0) as volume, coalesce(c.own, 0) as own_commission, coalesce(c.network, 0) as network_commission,
             coalesce(c.charges, 0) as charges_paid, coalesce(m.margin, 0) as company_margin
        from names n left join t on t.service = n.service left join c on c.service = n.service left join m on m.service = n.service
       order by coalesce(t.volume, 0) desc, n.service`;
    // binds order: user id then the dates, three times (t, c, m)
    const all = [];
    [0, 1, 2].forEach(() => {
      all.push(userId);
      if (f.startDate) all.push(f.startDate);
      if (f.endDate) all.push(f.endDate);
    });
    const { rows } = await db.raw(sql, all);
    return { user: asNumbers(user), services: rows.map(asNumbers) };
  },

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

  // Commission ledger with GST + TDS breakdown. Backs the Commission, GST and TDS reports (same
  // rows; each screen surfaces its own columns), with totals over the whole filter.
  // f.viaFor: add via_child_* = the viewer's direct child whose branch each row came from.
  async commissionLedger(f) {
    const filter = ledgerFilter(f);
    const page = await paginate(ledgerJoins, LEDGER_COLS, filter, f);
    if (f.viaFor) {
      const via = await viaChildOf(f.viaFor, page.rows.map((r) => r.source_user_id));
      page.rows = page.rows.map((r) => {
        const v = via[r.source_user_id];
        return { ...r, via_child_id: v ? v.child_id : null, via_child_code: v ? v.child_code : null, via_child_name: v ? v.child_name : null };
      });
    }
    const t = await ledgerJoins().where(filter).where((qb) => applyGridFilters(qb, f.grid)).first(
      db.raw("coalesce(sum(x.type_value_amount) filter (where x.wallet_txn_type = 'credit'), 0) as commission"),
      db.raw("coalesce(sum(x.gst_amount) filter (where x.wallet_txn_type = 'credit'), 0) as gst"),
      db.raw("coalesce(sum(x.tds_amount) filter (where x.wallet_txn_type = 'credit'), 0) as tds"),
      db.raw("coalesce(sum(x.net_amount) filter (where x.wallet_txn_type = 'credit'), 0) as net_credit"),
      db.raw("coalesce(sum(x.net_amount) filter (where x.wallet_txn_type = 'credit' and x.level = 0), 0) as own"),
      db.raw("coalesce(sum(x.net_amount) filter (where x.wallet_txn_type = 'credit' and x.level > 0), 0) as from_downline"),
      db.raw("coalesce(sum(x.net_amount) filter (where x.wallet_txn_type = 'debit'), 0) as charges"),
    );
    const totals = Object.fromEntries(Object.entries(t || {}).map(([k, v]) => [k, Number(v || 0)]));
    return { ...page, totals };
  },

  // Commission a user earned from each DIRECT child's branch (the child + everyone below it).
  async commissionByChild(userId, { startDate = null, endDate = null } = {}) {
    const dates = []; const binds = [];
    if (startDate) { dates.push('AND l.created_at::date >= ?'); binds.push(startDate); }
    if (endDate) { dates.push('AND l.created_at::date <= ?'); binds.push(endDate); }
    const { rows } = await db.raw(
      `WITH RECURSIVE sub(child_id, id, depth) AS (
         SELECT c.id, c.id, 0 FROM users c WHERE c.parent_id = ?
         UNION ALL
         SELECT sub.child_id, u.id, sub.depth + 1 FROM users u JOIN sub ON u.parent_id = sub.id WHERE sub.depth < 10)
       SELECT c.id AS child_id, coalesce(nullif(c.user_code, ''), c.username) AS code, c.full_name AS name, ut.name AS type_name, c.is_active,
              count(l.id)::int AS txns, coalesce(sum(l.type_value_amount), 0) AS commission, coalesce(sum(l.net_amount), 0) AS net
         FROM users c
         LEFT JOIN user_types ut ON ut.id = c.user_type_id
         LEFT JOIN sub ON sub.child_id = c.id
         LEFT JOIN commission_ledger l ON l.source_user_id = sub.id AND l.user_id = ? AND l.wallet_txn_type = 'credit' AND l.level > 0 ${dates.join(' ')}
        WHERE c.parent_id = ? AND c.user_type_id IS NOT NULL
        GROUP BY c.id, c.user_code, c.username, c.full_name, ut.name, c.is_active
        ORDER BY net DESC, c.id
        LIMIT 100`,
      [userId, userId, ...binds, userId],
    );
    return rows.map((r) => ({ ...r, commission: Number(r.commission), net: Number(r.net) }));
  },

  // Admin margin per successful transaction, plus totals over the whole filter.
  async adminMargins(f) {
    const filter = (qb) => { applyCommon(qb, f); if (f.service) qb.where('x.service_name', f.service); };
    const page = await paginate(marginJoins, ['x.*', ...USER_COLS, 'ap.name as provider_name'], filter, f);
    const t = await marginJoins().where(filter).where((qb) => applyGridFilters(qb, f.grid))
      .sum({ amount: 'x.amount', provider_commission: 'x.provider_commission', charges_collected: 'x.charges_collected', commission_paid: 'x.commission_paid', margin: 'x.margin' })
      .first();
    const totals = Object.fromEntries(Object.entries(t || {}).map(([k, v]) => [k, Number(v || 0)]));
    return { ...page, totals };
  },

  fundRequestById(id) { return fundRequestJoins().select(FR_COLS).where('x.id', id).first(); },
  updateFundRequest(id, patch) { return db('fund_requests').where({ id }).update({ ...patch, updated_at: db.fn.now() }); },
};
