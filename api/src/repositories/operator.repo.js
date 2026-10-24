'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, DATE_COL, STATUS_COL } = require('../utils/gridQuery');

// Operator Master: the operators the retailer screens, Commission Slots and SP Keys offer (operators table).
const GRID = {
  name: 'name', service: 'service', category: 'category', code: 'code',
  circle_required: { sort: 'circle_required', filter: "case when circle_required then 'yes circle' else 'no' end" },
  status: STATUS_COL('is_active'), created_at: DATE_COL('created_at'),
};

const TABLE = 'operators';

module.exports = {
  GRID,

  async list({ q = '', service = '', page = 1, pageSize = 10, grid = null } = {}) {
    const base = db(TABLE);
    if (service) base.where({ service });
    if (q) base.where((w) => w.whereILike('name', `%${q}%`).orWhereILike('category', `%${q}%`).orWhereILike('code', `%${q}%`));
    applyGridFilters(base, grid);
    const total = Number((await base.clone().count('id as c').first()).c);
    const rows = await base.clone().select('*').modify((qb) => applyGridSortFirst(qb, grid)).orderBy(['service', 'name']).limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total };
  },

  findById(id) { return db(TABLE).where({ id }).first(); },

  // Same name in the same group (case-insensitive): the retailer list and the slab / SP key dropdowns match operators by name.
  findByName(service, name) { return db(TABLE).where({ service }).whereRaw('lower(name) = lower(?)', [name]).first(); },

  create({ service, category, name, code, circleRequired, isActive }) {
    return db(TABLE).insert({ service, category, name, code, circle_required: circleRequired, is_active: isActive }).returning('*').then((r) => r[0]);
  },

  update(id, patch) { return db(TABLE).where({ id }).update(patch).returning('*').then((r) => r[0]); },

  remove(id) { return db(TABLE).where({ id }).del(); },

  /**
   * Where an operator name is already in use (transactions, commission slots, SP keys, package items): renaming or deleting
   * it would orphan those rows, because they keep the operator as text.
   */
  async usage(name) {
    const lc = String(name).toLowerCase();
    const count = async (table, col) => {
      try { return Number((await db(table).whereRaw(`lower(${col}) = ?`, [lc]).count('id as c').first()).c); } catch (e) { return 0; }
    };
    const [transactions, slabs, spKeys, packageItems] = await Promise.all([
      count('service_transactions', 'operator'), count('commission_slots', 'operator'),
      count('provider_products', 'operator'), count('commission_package_items', 'operator'),
    ]);
    return { transactions, slabs, spKeys, packageItems, total: transactions + slabs + spKeys + packageItems };
  },
};
