'use strict';

/**
 * Operator Master (admin): add / edit / switch off the operators (Airtel, Jio, Vi ...) that the retailer screens, Commission
 * Slots and API Management's SP Keys offer. Only a menu row - the operators table already exists. Placed in
 * "Masters & Configuration" after City Master.
 */
const SCOPE = 'admin';
const ROUTE = '/modules/operator-master';

exports.up = async function up(knex) {
  const group = await knex('menu_items').where({ scope: SCOPE, title: 'Masters & Configuration' }).whereNull('parent_id').first('id');
  if (!group) return;
  if (await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).first('id')) return;
  const last = await knex('menu_items').where({ parent_id: group.id }).max('sort_order as m').first();
  await knex('menu_items').insert({ parent_id: group.id, title: 'Operator Master', icon: 'phone', route: ROUTE, scope: SCOPE, sort_order: Number(last.m || 0) + 1, is_active: true });
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).del();
};
