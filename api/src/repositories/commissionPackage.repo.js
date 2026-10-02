'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, DATE_COL, STATUS_COL } = require('../utils/gridQuery');

const USERS_COUNT = '(select count(*) from users au where au.commission_package_id = cp.id)';
// Sortable / filterable grid columns (keys = the app's DataGrid column keys).
const GRID = {
  name: 'cp.name', user_type: 'ut.name', users: USERS_COUNT, status: STATUS_COL('cp.is_active'), created_at: DATE_COL('cp.created_at'),
  owner: { sort: 'o.user_code', filter: "concat_ws(' ', o.user_code, o.full_name)" },
};

const joined = () => db('commission_packages as cp')
  .join('user_types as ut', 'ut.id', 'cp.user_type_id')
  .join('users as o', 'o.id', 'cp.owner_user_id');
const COLS = ['cp.*', 'ut.name as user_type_name', 'o.user_code as owner_code', 'o.full_name as owner_name', db.raw(`${USERS_COUNT}::int as users_count`)];

async function items(packageIds, trx = db) {
  if (!packageIds.length) return [];
  return trx('commission_package_items as i').join('services as s', 's.id', 'i.service_id')
    .whereIn('i.package_id', packageIds).orderBy(['i.package_id', 's.title', 'i.operator'])
    .select('i.id', 'i.package_id', 'i.service_id', 's.title as service_name', 'i.operator', 'i.commission_type', 'i.value');
}

module.exports = {
  GRID,

  /** ownerId = only that upline's packages (network panel); null = every package (admin, read-only). */
  async list({ ownerId = null, grid = null, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => { if (ownerId) qb.where('cp.owner_user_id', ownerId); applyGridFilters(qb, grid); };
    const countRow = await joined().where(filter).count('cp.id as c').first();
    const rows = await joined().where(filter).select(COLS)
      .modify((qb) => applyGridSortFirst(qb, grid)).orderBy('cp.id', 'desc')
      .limit(pageSize).offset((page - 1) * pageSize);
    const its = await items(rows.map((r) => r.id));
    return { rows: rows.map((r) => ({ ...r, items: its.filter((i) => i.package_id === r.id) })), total: Number(countRow.c) };
  },

  async find(id, ownerId = null, trx = db) {
    const q = trx('commission_packages as cp').join('user_types as ut', 'ut.id', 'cp.user_type_id').join('users as o', 'o.id', 'cp.owner_user_id')
      .where('cp.id', id);
    if (ownerId) q.where('cp.owner_user_id', ownerId);
    const row = await q.first(COLS);
    return row ? { ...row, items: await items([row.id], trx) } : null;
  },

  /** Create or replace a package and its items in one transaction. */
  async save(ownerId, { id = null, name, userTypeId, isActive = true, items: list }) {
    return db.transaction(async (trx) => {
      let pkgId = id;
      if (pkgId) {
        await trx('commission_packages').where({ id: pkgId, owner_user_id: ownerId })
          .update({ name, user_type_id: userTypeId, is_active: isActive, updated_at: trx.fn.now() });
        await trx('commission_package_items').where({ package_id: pkgId }).del();
      } else {
        const [r] = await trx('commission_packages').insert({ owner_user_id: ownerId, name, user_type_id: userTypeId, is_active: isActive }).returning('id');
        pkgId = typeof r === 'object' ? r.id : r;
      }
      if (list.length) {
        await trx('commission_package_items').insert(list.map((i) => ({
          package_id: pkgId, service_id: i.serviceId, operator: i.operator || null, commission_type: i.commissionType, value: i.value,
        })));
      }
      return pkgId;
    });
  },

  usersOf(id) { return db('users').where({ commission_package_id: id }).count('id as c').first().then((r) => Number(r.c)); },

  /** Delete a package; with unassign, its users go back to the admin default first. */
  async remove(id, ownerId, { unassign = false } = {}) {
    return db.transaction(async (trx) => {
      if (unassign) await trx('users').where({ commission_package_id: id }).update({ commission_package_id: null, updated_at: trx.fn.now() });
      await trx('commission_packages').where({ id, owner_user_id: ownerId }).del();
    });
  },
};
