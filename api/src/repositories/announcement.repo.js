'use strict';

const db = require('../config/db');

const TABLE = 'announcements';

function joined() {
  return db(`${TABLE} as a`)
    .leftJoin('user_types as u', 'u.id', 'a.user_type_id')
    .select('a.id', 'a.title', 'a.message', 'a.is_active', 'a.created_at', 'a.updated_at', 'a.user_type_id', 'u.name as user_type_name');
}

module.exports = {
  async list({ q = '', page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => { if (q) qb.where((w) => w.whereILike('a.message', `%${q}%`).orWhereILike('u.name', `%${q}%`)); };
    const countRow = await db(`${TABLE} as a`).leftJoin('user_types as u', 'u.id', 'a.user_type_id').where(filter).count('a.id as c').first();
    const rows = await joined().where(filter).orderBy('a.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  activeForUserType(userTypeId = null) {
    const qb = joined().where('a.is_active', true);
    if (userTypeId) qb.andWhere((w) => w.where('a.user_type_id', userTypeId).orWhereNull('a.user_type_id'));
    return qb.orderBy('a.id', 'desc');
  },
  findById(id) { return joined().where('a.id', id).first(); },
  create({ userTypeId, title, message, isActive = true }) {
    return db(TABLE).insert({ user_type_id: userTypeId || null, title: title || null, message: message || null, is_active: isActive })
      .returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },
  update(id, { userTypeId, title, message, isActive }) {
    const patch = { updated_at: db.fn.now() };
    if (userTypeId !== undefined) patch.user_type_id = userTypeId || null;
    if (title !== undefined) patch.title = title || null;
    if (message !== undefined) patch.message = message || null;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
