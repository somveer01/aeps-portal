'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst } = require('../utils/gridQuery');

// Sortable / filterable grid columns.
const GRID = { state: 's.name', name: 'c.name' };

const TABLE = 'cities';

// Base query joining the state name.
function withState() {
  return db(`${TABLE} as c`)
    .join('states as s', 's.id', 'c.state_id')
    .select('c.id', 'c.name', 'c.is_active', 'c.created_at', 'c.state_id', 's.name as state_name');
}

module.exports = {
  GRID,
  /** Paginated + searchable (matches city OR state name). Returns { rows, total }. */
  async list({ q = '', stateId = null, page = 1, pageSize = 10, grid = null } = {}) {
    const filter = (qb) => {
      if (stateId) qb.where('c.state_id', stateId);
      if (q) qb.andWhere((w) => w.whereILike('c.name', `%${q}%`).orWhereILike('s.name', `%${q}%`));
      applyGridFilters(qb, grid);
    };

    const countRow = await db(`${TABLE} as c`)
      .join('states as s', 's.id', 'c.state_id')
      .where(filter)
      .count('c.id as c')
      .first();

    const rows = await withState()
      .where(filter)
      .modify((qb) => applyGridSortFirst(qb, grid))
      .orderBy([{ column: 's.name', order: 'asc' }, { column: 'c.name', order: 'asc' }])
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { rows, total: Number(countRow.c) };
  },

  findById(id) {
    return withState().where('c.id', id).first();
  },

  findByStateAndName(stateId, name) {
    return db(TABLE).where({ state_id: stateId }).whereRaw('LOWER(name) = LOWER(?)', [name]).first();
  },

  create({ stateId, name, isActive = true }) {
    return db(TABLE).insert({ state_id: stateId, name, is_active: isActive }).returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },

  update(id, { stateId, name, isActive }) {
    const patch = {};
    if (stateId !== undefined) patch.state_id = stateId;
    if (name !== undefined) patch.name = name;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch);
  },

  remove(id) {
    return db(TABLE).where({ id }).del();
  },
};
