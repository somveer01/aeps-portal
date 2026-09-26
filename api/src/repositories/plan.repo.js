'use strict';

const db = require('../config/db');

const TABLE = 'plans';

function withUserType() {
  return db(`${TABLE} as p`)
    .join('user_types as u', 'u.id', 'p.user_type_id')
    .select('p.id', 'p.name', 'p.is_active', 'p.created_at', 'p.user_type_id', 'u.name as user_type_name');
}

module.exports = {
  async list({ q = '', userTypeId = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (userTypeId) qb.where('p.user_type_id', userTypeId);
      if (q) qb.andWhere((w) => w.whereILike('p.name', `%${q}%`).orWhereILike('u.name', `%${q}%`));
    };
    const countRow = await db(`${TABLE} as p`).join('user_types as u', 'u.id', 'p.user_type_id').where(filter).count('p.id as c').first();
    const rows = await withUserType().where(filter).orderBy('p.id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
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
