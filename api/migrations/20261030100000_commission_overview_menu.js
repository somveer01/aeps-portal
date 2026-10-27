'use strict';

/**
 * Commission Overview (admin): per service and operator, what the API pays the company, what each level (Super Distributor,
 * Distributor, Retailer ...) is paid and the company's margin; slabs can be edited there. Only a menu row - the data is
 * commission_slots / provider_products / services. Placed in "Commission & Margin" after Admin Margin.
 */
const SCOPE = 'admin';
const ROUTE = '/commission-overview';

exports.up = async function up(knex) {
  const group = await knex('menu_items').where({ scope: SCOPE, title: 'Commission & Margin' }).whereNull('parent_id').first('id');
  if (!group) return;
  if (await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).first('id')) return;
  const last = await knex('menu_items').where({ parent_id: group.id }).max('sort_order as m').first();
  await knex('menu_items').insert({ parent_id: group.id, title: 'Commission Overview', icon: 'commission', route: ROUTE, scope: SCOPE, sort_order: Number(last.m || 0) + 1, is_active: true });
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).del();
};
