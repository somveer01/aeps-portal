'use strict';

const db = require('../config/db');
const { downlineIds } = require('./network.repo');

// Managed users = those with a user_type (retailers/distributors/etc.), not the admin.
function joined() {
  return db('users as u')
    .leftJoin('user_types as ut', 'ut.id', 'u.user_type_id')
    .leftJoin('plans as p', 'p.id', 'u.plan_id')
    .leftJoin('users as par', 'par.id', 'u.parent_id')
    .leftJoin('users as cr', 'cr.id', 'u.created_by')
    .leftJoin('states as st', 'st.id', 'u.state_id')
    .leftJoin('cities as ci', 'ci.id', 'u.city_id')
    .whereNotNull('u.user_type_id')
    .select(
      'u.id', 'u.user_code', 'u.shop_name', 'u.full_name as name', 'u.mobile', 'u.email',
      'u.wallet_balance', 'u.is_active', 'u.kyc_status', 'u.ekyc_status', 'u.created_at as join_date',
      'u.user_type_id', 'ut.name as user_type_name', 'u.plan_id', 'p.name as plan_name',
      'u.parent_id', 'par.user_code as parent_code', 'par.full_name as parent_name',
      'u.created_by', db.raw("coalesce(nullif(cr.user_code, ''), cr.username) as created_by_code"), 'cr.full_name as created_by_name',
      'u.father_husband_name', db.raw("to_char(u.dob,'YYYY-MM-DD') as dob"), 'u.pan_number', 'u.aadhar_number',
      'u.gender', 'u.gst_number', 'u.min_balance', 'u.address', 'u.state_id', 'st.name as state_name',
      'u.city_id', 'ci.name as city_name', 'u.pincode', 'u.merchant_id', 'u.assigned_employee_id',
      'u.service_access', 'u.module_access',
    );
}

module.exports = {
  // downlineOf: limit to users below that user in the parent chain (distributor / MD panel).
  async list({ q = '', userTypeId = null, kycStatus = '', accountStatus = '', parentUser = '', downlineOf = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (downlineOf) qb.whereIn('u.id', downlineIds(downlineOf));
      if (userTypeId) qb.where('u.user_type_id', userTypeId);
      if (kycStatus) qb.where('u.kyc_status', kycStatus);
      if (accountStatus === 'active') qb.where('u.is_active', true);
      if (accountStatus === 'inactive') qb.where('u.is_active', false);
      if (parentUser) qb.andWhere((w) => w.whereILike('par.user_code', `%${parentUser}%`).orWhereILike('par.full_name', `%${parentUser}%`));
      if (q) qb.andWhere((w) => w.whereILike('u.full_name', `%${q}%`).orWhereILike('u.shop_name', `%${q}%`).orWhereILike('u.mobile', `%${q}%`).orWhereILike('u.email', `%${q}%`).orWhereILike('u.user_code', `%${q}%`));
    };
    const countRow = await db('users as u')
      .leftJoin('users as par', 'par.id', 'u.parent_id')
      .whereNotNull('u.user_type_id').where(filter).count('u.id as c').first();
    const rows = await joined().where(filter).orderBy('u.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
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
  update(id, patch) {
    const p = { ...patch, updated_at: db.fn.now() };
    if (p.service_access !== undefined) p.service_access = p.service_access ? JSON.stringify(p.service_access) : null;
    if (p.module_access !== undefined) p.module_access = p.module_access ? JSON.stringify(p.module_access) : null;
    return db('users').where({ id }).update(p);
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
