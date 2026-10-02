'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, DATE_COL, STATUS_COL } = require('../utils/gridQuery');

// Sortable / filterable grid columns.
const GRID = { title: 'title', type: 'type', created_at: DATE_COL('created_at'), updated_at: DATE_COL('updated_at'), status: STATUS_COL('is_active') };

const TABLE = 'application_banners';

const SELECT = ['id', 'title', 'image', 'link', 'type', 'sort_order', 'is_active', 'created_at', 'updated_at'];

module.exports = {
  GRID,
  async list({ q = '', page = 1, pageSize = 10, grid = null } = {}) {
    const base = db(TABLE);
    if (q) base.whereILike('title', `%${q}%`);
    applyGridFilters(base, grid);
    const countRow = await base.clone().count('id as c').first();
    const rows = await base.clone().select(SELECT).modify((qb) => applyGridSortFirst(qb, grid)).orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'desc' }]).limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return db(TABLE).select(SELECT).where({ id }).first(); },
  create({ title, image, link, type = 'login', sortOrder = 0, isActive = true }) {
    return db(TABLE).insert({ title, image: image || null, link: link || null, type, sort_order: sortOrder, is_active: isActive })
      .returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },
  update(id, { title, image, link, type, sortOrder, isActive }) {
    const patch = { updated_at: db.fn.now() };
    if (title !== undefined) patch.title = title;
    if (image !== undefined) patch.image = image || null;
    if (link !== undefined) patch.link = link || null;
    if (type !== undefined) patch.type = type;
    if (sortOrder !== undefined) patch.sort_order = sortOrder;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
