'use strict';

const db = require('../config/db');
const { downlineIds } = require('./network.repo');
const { applyGridFilters, applyGridSort, DATE_TEXT } = require('../utils/gridQuery');

// Sortable / filterable Users Manager columns (keys = the app's DataGrid column keys).
const USERS_GRID = {
  shop_name: 'u.shop_name', name: 'u.full_name', mobile: 'u.mobile', user_code: 'u.user_code', user_type: 'ut.name',
  email: 'u.email', wallet: 'u.wallet_balance', plan: 'p.name',
  join_date: { sort: 'u.created_at', filter: DATE_TEXT('u.created_at') },
  parent: { sort: 'par.user_code', filter: "concat_ws(' ', par.user_code, par.full_name)" },
  created_by: { sort: 'cr.user_code', filter: "concat_ws(' ', coalesce(nullif(cr.user_code, ''), cr.username), cr.full_name)" },
  status: { sort: 'u.is_active', filter: "case when u.is_active then 'active' else 'inactive blocked' end" },
  ekyc: 'u.ekyc_status', kyc: 'u.kyc_status', package: 'cpk.name',
};

// Managed users = those with a user_type (retailers/distributors/etc.), not the admin.
function base() {
  return db('users as u')
    .leftJoin('user_types as ut', 'ut.id', 'u.user_type_id')
    .leftJoin('plans as p', 'p.id', 'u.plan_id')
    .leftJoin('users as par', 'par.id', 'u.parent_id')
    .leftJoin('users as cr', 'cr.id', 'u.created_by')
    .leftJoin('states as st', 'st.id', 'u.state_id')
    .leftJoin('cities as ci', 'ci.id', 'u.city_id')
    .leftJoin('commission_packages as cpk', 'cpk.id', 'u.commission_package_id')
    .whereNotNull('u.user_type_id');
}

function joined() {
  return base()
    .select(
      'u.id', 'u.user_code', 'u.shop_name', 'u.full_name as name', 'u.mobile', 'u.email',
      'u.wallet_balance', 'u.is_active', 'u.kyc_status', 'u.ekyc_status', 'u.created_at as join_date',
      'u.user_type_id', 'ut.name as user_type_name', 'u.plan_id', 'p.name as plan_name',
      'u.parent_id', 'par.user_code as parent_code', 'par.full_name as parent_name', 'par.role as parent_role',
      'u.created_by', db.raw("coalesce(nullif(cr.user_code, ''), cr.username) as created_by_code"), 'cr.full_name as created_by_name',
      'u.father_husband_name', db.raw("to_char(u.dob,'YYYY-MM-DD') as dob"), 'u.pan_number', 'u.aadhar_number',
      'u.gender', 'u.gst_number', 'u.min_balance', 'u.address', 'u.state_id', 'st.name as state_name',
      'u.city_id', 'ci.name as city_name', 'u.pincode', 'u.merchant_id', 'u.assigned_employee_id',
      // Service ids ticked for this user (Service Permissions: override, else type default).
      db.raw(`(select coalesce(json_agg(s.id order by s.id), '[]'::json) from services s
        left join user_type_services t on t.service_id = s.id and t.user_type_id = u.user_type_id
        left join user_service_overrides o on o.service_id = s.id and o.user_id = u.id
        where coalesce(o.allowed, t.service_id is not null)) as service_access`),
      'u.module_access', 'u.commission_package_id', 'cpk.name as commission_package_name',
    );
}

module.exports = {
  USERS_GRID,
  // downlineOf: limit to users below that user in the parent chain (distributor / MD panel).
  // grid = parseGrid(query, USERS_GRID): column sort + filters over all matching users.
  async list({ q = '', userTypeId = null, kycStatus = '', accountStatus = '', parentUser = '', downlineOf = null, grid = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (downlineOf) qb.whereIn('u.id', downlineIds(downlineOf));
      if (userTypeId) qb.where('u.user_type_id', userTypeId);
      if (kycStatus) qb.where('u.kyc_status', kycStatus);
      if (accountStatus === 'active') qb.where('u.is_active', true);
      if (accountStatus === 'inactive') qb.where('u.is_active', false);
      if (parentUser) qb.andWhere((w) => w.whereILike('par.user_code', `%${parentUser}%`).orWhereILike('par.full_name', `%${parentUser}%`));
      if (q) qb.andWhere((w) => w.whereILike('u.full_name', `%${q}%`).orWhereILike('u.shop_name', `%${q}%`).orWhereILike('u.mobile', `%${q}%`).orWhereILike('u.email', `%${q}%`).orWhereILike('u.user_code', `%${q}%`));
      applyGridFilters(qb, grid);
    };
    const countRow = await base().where(filter).count('u.id as c').first();
    const q2 = joined().where(filter);
    applyGridSort(q2, grid, 'u.id', 'desc');
    const rows = await q2.limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  // Typeahead for the user picker: a few slim rows (no PAN / Aadhaar / email), best matches first.
  // downlineOf limits it to a user's downline (directOnly: direct children); id / userCode resolve one saved value.
  async search({ q = '', userTypeId = null, userTypeIds = null, downlineOf = null, directOnly = false, id = null, userCode = '', limit = 20 } = {}) {
    const qb = base().select('u.id', 'u.user_code', 'u.full_name as name', 'u.shop_name', 'u.mobile', 'u.user_type_id', 'ut.name as user_type_name', 'u.wallet_balance', 'u.is_active');
    if (downlineOf) {
      if (directOnly) qb.where('u.parent_id', downlineOf);
      else qb.whereIn('u.id', downlineIds(downlineOf));
    }
    if (userTypeId) qb.where('u.user_type_id', userTypeId);
    if (Array.isArray(userTypeIds) && userTypeIds.length) qb.whereIn('u.user_type_id', userTypeIds); // several types, e.g. every type above a user
    if (id) qb.where('u.id', id);
    if (userCode) qb.whereRaw('lower(u.user_code) = lower(?)', [userCode]);
    const s = String(q || '').trim();
    if (s) {
      const like = `%${s.replace(/[\\%_]/g, '\\$&')}%`;
      qb.andWhere((w) => w.whereILike('u.user_code', like).orWhereILike('u.full_name', like).orWhereILike('u.shop_name', like).orWhereILike('u.mobile', like));
      qb.orderByRaw("case when lower(u.user_code) = lower(?) then 0 when lower(u.user_code) like lower(?) then 1 else 2 end", [s, `${s.replace(/[\\%_]/g, '\\$&')}%`]);
    }
    return qb.orderBy('u.full_name').orderBy('u.id').limit(Math.min(20, Math.max(1, limit || 20)));
  },
  findFull(id) { return joined().where('u.id', id).first(); },
  countManaged() { return db('users').whereNotNull('user_type_id').count('id as c').first().then((r) => Number(r.c)); },
  usernameExists(username) { return db('users').where({ username }).first().then((r) => !!r); },
  create(data) {
    const d = { ...data };
    if (d.service_access !== undefined) d.service_access = d.service_access ? JSON.stringify(d.service_access) : null;
    if (d.module_access !== undefined) d.module_access = d.module_access ? JSON.stringify(d.module_access) : null;
    return db('users').insert(d).returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },
  // trx: run inside the caller's transaction (role change moves several rows together).
  update(id, patch, trx = db) {
    const p = { ...patch, updated_at: db.fn.now() };
    if (p.service_access !== undefined) p.service_access = p.service_access ? JSON.stringify(p.service_access) : null;
    if (p.module_access !== undefined) p.module_access = p.module_access ? JSON.stringify(p.module_access) : null;
    return trx('users').where({ id }).update(p);
  },
  // Atomically adjust wallet, refusing debits that would go negative.
  // Returns true if a row was updated, false otherwise (insufficient balance).
  adjustWalletGuarded(id, delta) {
    return db('users')
      .where({ id })
      .andWhereRaw('wallet_balance + ? >= 0', [delta])
      .update({ wallet_balance: db.raw('wallet_balance + ?', [delta]), updated_at: db.fn.now() })
      .then((count) => count > 0);
  },
};
