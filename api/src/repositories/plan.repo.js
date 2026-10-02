'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, DATE_COL, STATUS_COL } = require('../utils/gridQuery');

// Sortable / filterable grid columns.
const GRID = { user_type: 'u.name', name: 'p.name', created_at: DATE_COL('p.created_at'), status: STATUS_COL('p.is_active') };

const TABLE = 'plans';

function withUserType() {
  return db(`${TABLE} as p`)
    .join('user_types as u', 'u.id', 'p.user_type_id')
    .select('p.id', 'p.name', 'p.is_active', 'p.created_at', 'p.user_type_id', 'u.name as user_type_name');
}

module.exports = {
  GRID,
  async list({ q = '', userTypeId = null, page = 1, pageSize = 10, grid = null } = {}) {
    const filter = (qb) => {
      if (userTypeId) qb.where('p.user_type_id', userTypeId);
      if (q) qb.andWhere((w) => w.whereILike('p.name', `%${q}%`).orWhereILike('u.name', `%${q}%`));
      applyGridFilters(qb, grid);
    };
    const countRow = await db(`${TABLE} as p`).join('user_types as u', 'u.id', 'p.user_type_id').where(filter).count('p.id as c').first();
    const rows = await withUserType().where(filter).modify((qb) => applyGridSortFirst(qb, grid)).orderBy('p.id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return withUserType().where('p.id', id).first(); },
  create({ userTypeId, name, isActive = true }) {
    return db(TABLE).insert({ user_type_id: userTypeId, name, is_active: isActive }).returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },
  update(id, { userTypeId, name, isActive }) {
    const patch = { updated_at: db.fn.now() };
    if (userTypeId !== undefined) patch.user_type_id = userTypeId;
    if (name !== undefined) patch.name = name;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
