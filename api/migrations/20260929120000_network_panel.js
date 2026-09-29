'use strict';

/**
 * Distributor / Master Distributor panel.
 *  - user_types.parent_type_id: which user type sits directly above this one. A managed
 *    user can create users of every type whose parent type is their own type.
 *  - menu scope 'network': items shown only to managed users who can have a downline.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('user_types', (t) => {
    t.integer('parent_type_id').nullable().references('id').inTable('user_types').onDelete('SET NULL');
  });

  // Default chain: Super Distributor → Distributor → Retailer (only where both types exist).
  const byName = async (name) => knex('user_types').whereRaw('lower(name) = lower(?)', [name]).first('id');
  const link = async (child, parent) => {
    const c = await byName(child); const p = await byName(parent);
    if (c && p) await knex('user_types').where({ id: c.id }).whereNull('parent_type_id').update({ parent_type_id: p.id });
  };
  await link('Distributor', 'Super Distributor');
  await link('Retailer', 'Distributor');

  if (!(await knex('menu_items').where({ route: '/network/users' }).first())) {
    const [g] = await knex('menu_items').insert({ parent_id: null, title: 'My Network', icon: 'users', route: null, sort_order: 1, scope: 'network', is_active: true }).returning('id');
    const groupId = typeof g === 'object' ? g.id : g;
    await knex('menu_items').insert([
      { parent_id: groupId, title: 'My Users', icon: 'users', route: '/network/users', sort_order: 1, scope: 'network', is_active: true },
      { parent_id: groupId, title: 'Fund Transfer', icon: 'transfer', route: '/network/fund-transfer', sort_order: 2, scope: 'network', is_active: true },
      { parent_id: groupId, title: 'All Fund Transfers', icon: 'transfer', route: '/network/fund-transfers', sort_order: 3, scope: 'network', is_active: true },
      { parent_id: groupId, title: 'Downline Report', icon: 'report', route: '/network/report', sort_order: 4, scope: 'network', is_active: true },
    ]);
  }
};

exports.down = async function down(knex) {
  const kids = await knex('menu_items').whereIn('route', ['/network/users', '/network/fund-transfer', '/network/fund-transfers', '/network/report']).select('parent_id');
  await knex('menu_items').whereIn('id', kids.map((k) => k.parent_id).filter(Boolean)).del();
  await knex('menu_items').whereIn('route', ['/network/users', '/network/fund-transfer', '/network/fund-transfers', '/network/report']).del();
  await knex.schema.alterTable('user_types', (t) => { t.dropColumn('parent_type_id'); });
};
