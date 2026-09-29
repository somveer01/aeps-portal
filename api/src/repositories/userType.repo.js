'use strict';

const db = require('../config/db');

const TABLE = 'user_types';

module.exports = {
  async list({ q = '', page = 1, pageSize = 10 } = {}) {
    const base = db(`${TABLE} as t`).leftJoin(`${TABLE} as pt`, 'pt.id', 't.parent_type_id');
    if (q) base.whereILike('t.name', `%${q}%`);
    const countRow = await base.clone().count('t.id as c').first();
    const rows = await base.clone().select('t.*', 'pt.name as parent_type_name').orderBy('t.id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return db(TABLE).where({ id }).first(); },
  findByName(name) { return db(TABLE).whereRaw('LOWER(name)=LOWER(?)', [name]).first(); },
  create({ name, isActive = true, parentTypeId = null }) {
    return db(TABLE).insert({ name, is_active: isActive, parent_type_id: parentTypeId }).returning('*').then((r) => r[0]);
  },
  update(id, { name, isActive, parentTypeId }) {
    const patch = { updated_at: db.fn.now() };
    if (parentTypeId !== undefined) patch.parent_type_id = parentTypeId;
    if (name !== undefined) patch.name = name;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch).returning('*').then((r) => r[0]);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
