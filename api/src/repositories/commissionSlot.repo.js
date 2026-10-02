'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, STATUS_COL } = require('../utils/gridQuery');

// Sortable / filterable grid columns of Commission Slots and Commission Slab.
const GRID = {
  user_type: 'u.name', service: { sort: 's.title', filter: "concat_ws(' ', s.title, cs.operator)" }, plan: 'p.name',
  commission_type: { sort: 'cs.commission_type', filter: "case when cs.commission_type = 'amount' then 'by amount' else 'by percentage' end" },
  range: { sort: 'cs.min_amount', filter: "concat_ws(' - ', cs.min_amount, cs.max_amount)" }, value: 'cs.value',
  txn_type: 'cs.txn_type', chain_type: 'cs.chain_type', status: STATUS_COL('cs.is_active'),
};

const TABLE = 'commission_slots';

function joined() {
  return db(`${TABLE} as cs`)
    .join('user_types as u', 'u.id', 'cs.user_type_id')
    .join('services as s', 's.id', 'cs.service_id')
    .join('plans as p', 'p.id', 'cs.plan_id')
    .select(
      'cs.id', 'cs.operator', 'cs.commission_type', 'cs.min_amount', 'cs.max_amount', 'cs.value',
      'cs.chain_type', 'cs.specific_user', 'cs.txn_type', 'cs.is_active', 'cs.created_at',
      'cs.user_type_id', 'u.name as user_type_name',
      'cs.service_id', 's.title as service_name',
      'cs.plan_id', 'p.name as plan_name',
    );
}

module.exports = {
  GRID,
  async list({ q = '', page = 1, pageSize = 10, grid = null } = {}) {
    const filter = (qb) => {
      if (q) qb.where((w) => w.whereILike('s.title', `%${q}%`).orWhereILike('u.name', `%${q}%`).orWhereILike('p.name', `%${q}%`));
      applyGridFilters(qb, grid);
    };
    const countRow = await db(`${TABLE} as cs`)
      .join('user_types as u', 'u.id', 'cs.user_type_id')
      .join('services as s', 's.id', 'cs.service_id')
      .join('plans as p', 'p.id', 'cs.plan_id')
      .where(filter).count('cs.id as c').first();
    const rows = await joined().where(filter).modify((qb) => applyGridSortFirst(qb, grid)).orderBy('cs.id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  // Read-only "Commission Slab" listing filtered by user type + service.
  async slab({ userTypeId = null, serviceId = null, activeServicesOnly = false, serviceIds = null, grid = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (activeServicesOnly) qb.where('s.is_active', true);
      if (serviceIds) qb.whereIn('cs.service_id', serviceIds);
      if (userTypeId) qb.where('cs.user_type_id', userTypeId);
      if (serviceId) qb.where('cs.service_id', serviceId);
      applyGridFilters(qb, grid);
    };
    const countRow = await db(`${TABLE} as cs`)
      .join('user_types as u', 'u.id', 'cs.user_type_id')
      .join('services as s', 's.id', 'cs.service_id')
      .join('plans as p', 'p.id', 'cs.plan_id')
      .where(filter).count('cs.id as c').first();
    const rows = await joined().where(filter).modify((qb) => applyGridSortFirst(qb, grid)).orderBy('cs.id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },

  findById(id) { return joined().where('cs.id', id).first(); },
  create(d) {
    return db(TABLE).insert({
      user_type_id: d.userTypeId, service_id: d.serviceId, plan_id: d.planId, operator: d.operator || null,
      commission_type: d.commissionType, min_amount: d.minAmount, max_amount: d.maxAmount, value: d.value,
      chain_type: d.chainType, specific_user: d.specificUser || null, is_active: d.isActive !== false,
    }).returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },
  update(id, d) {
    const patch = { updated_at: db.fn.now() };
    if (d.userTypeId !== undefined) patch.user_type_id = d.userTypeId;
    if (d.serviceId !== undefined) patch.service_id = d.serviceId;
    if (d.planId !== undefined) patch.plan_id = d.planId;
    if (d.operator !== undefined) patch.operator = d.operator || null;
    if (d.commissionType !== undefined) patch.commission_type = d.commissionType;
    if (d.minAmount !== undefined) patch.min_amount = d.minAmount;
    if (d.maxAmount !== undefined) patch.max_amount = d.maxAmount;
    if (d.value !== undefined) patch.value = d.value;
    if (d.chainType !== undefined) patch.chain_type = d.chainType;
    if (d.specificUser !== undefined) patch.specific_user = d.specificUser || null;
    if (d.isActive !== undefined) patch.is_active = d.isActive;
    return db(TABLE).where({ id }).update(patch);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
