'use strict';

const db = require('../config/db');

const TABLE = 'services';

function withCategory() {
  return db(`${TABLE} as s`)
    .join('service_categories as c', 'c.id', 's.service_category_id')
    .select('s.id', 's.title', 's.icon', 's.service_type', 's.is_active', 's.created_at', 's.service_category_id', 'c.name as category_name');
}

module.exports = {
  async list({ q = '', page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (q) qb.where((w) => w.whereILike('s.title', `%${q}%`).orWhereILike('c.name', `%${q}%`));
    };
    const countRow = await db(`${TABLE} as s`)
      .join('service_categories as c', 'c.id', 's.service_category_id')
      .where(filter).count('s.id as c').first();
    const rows = await withCategory().where(filter).orderBy('s.id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return withCategory().where('s.id', id).first(); },
  findByTitle(title) { return db(TABLE).whereRaw('LOWER(title)=LOWER(?)', [title]).first(); },
  create({ title, serviceCategoryId, serviceType = 'internal', icon = null, isActive = true }) {
    return db(TABLE).insert({ title, service_category_id: serviceCategoryId, service_type: serviceType, icon, is_active: isActive })
      .returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },
  update(id, { title, serviceCategoryId, serviceType, icon, isActive }) {
    const patch = { updated_at: db.fn.now() };
    if (title !== undefined) patch.title = title;
    if (serviceCategoryId !== undefined) patch.service_category_id = serviceCategoryId;
    if (serviceType !== undefined) patch.service_type = serviceType;
    if (icon !== undefined) patch.icon = icon;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
