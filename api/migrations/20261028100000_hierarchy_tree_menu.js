'use strict';

/**
 * Hierarchy Tree (admin): the whole network as a tree (Admin -> Super Distributor -> Distributor -> Retailer). Only a menu row -
 * the data is users.parent_id. Placed in "User Management" after Retailer Master.
 */
const SCOPE = 'admin';
const ROUTE = '/hierarchy-tree';

exports.up = async function up(knex) {
  const group = await knex('menu_items').where({ scope: SCOPE, title: 'User Management' }).whereNull('parent_id').first('id');
  if (!group) return;
  if (await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).first('id')) return;
  const last = await knex('menu_items').where({ parent_id: group.id }).max('sort_order as m').first();
  await knex('menu_items').insert({ parent_id: group.id, title: 'Hierarchy Tree', icon: 'layers', route: ROUTE, scope: SCOPE, sort_order: Number(last.m || 0) + 1, is_active: true });
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).del();
};
