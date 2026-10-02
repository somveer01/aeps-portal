'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, DATE_COL, STATUS_COL } = require('../utils/gridQuery');

// Sortable / filterable grid columns.
const GRID = { name: 'name', created_at: DATE_COL('created_at'), status: STATUS_COL('is_active') };

const TABLE = 'ticket_departments';

module.exports = {
  GRID,
  async list({ q = '', page = 1, pageSize = 10, grid = null } = {}) {
    const base = db(TABLE);
    if (q) base.whereILike('name', `%${q}%`);
    applyGridFilters(base, grid);
    const countRow = await base.clone().count('id as c').first();
    const rows = await base.clone().select('*').modify((qb) => applyGridSortFirst(qb, grid)).orderBy('id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return db(TABLE).where({ id }).first(); },
  findByName(name) { return db(TABLE).whereRaw('LOWER(name)=LOWER(?)', [name]).first(); },
  create({ name, isActive = true }) {
    return db(TABLE).insert({ name, is_active: isActive }).returning('*').then((r) => r[0]);
  },
  update(id, { name, isActive }) {
    const patch = { updated_at: db.fn.now() };
    if (name !== undefined) patch.name = name;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch).returning('*').then((r) => r[0]);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
