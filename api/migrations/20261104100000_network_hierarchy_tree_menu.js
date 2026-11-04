'use strict';

/**
 * Users Hierarchy Tree for Super Distributor / Distributor: the users below them as a read-only tree. Only a menu row in "My Network"
 * (scope 'network' = shown to managed users that can have a downline) - the data is users.parent_id, and who may create whom is untouched.
 */
const SCOPE = 'network';
const ROUTE = '/network/hierarchy-tree';

exports.up = async function up(knex) {
  const group = await knex('menu_items').where({ scope: SCOPE, title: 'My Network' }).whereNull('parent_id').first('id');
  if (!group) return;
  if (await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).first('id')) return;
  const last = await knex('menu_items').where({ parent_id: group.id }).max('sort_order as m').first();
  await knex('menu_items').insert({ parent_id: group.id, title: 'Users Hierarchy Tree', icon: 'layers', route: ROUTE, scope: SCOPE, sort_order: Number(last.m || 0) + 1, is_active: true });
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).del();
};
