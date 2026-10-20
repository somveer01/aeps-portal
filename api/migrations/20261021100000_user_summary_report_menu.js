'use strict';

/**
 * User Summary report (admin): one row per user with transactions, commission earned, charges paid, wallet added,
 * refunds and the company's margin, plus a per-service drill-down. Only a menu row - no new table.
 * Placed first in the admin "Reports" group.
 */
const SCOPE = 'admin';
const ROUTE = '/user-summary-report';

exports.up = async function up(knex) {
  const group = await knex('menu_items').where({ scope: SCOPE, title: 'Reports' }).whereNull('parent_id').first('id');
  if (!group) return; // a database without the Reports group: nothing to attach to
  if (await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).first('id')) return;
  await knex('menu_items').where({ parent_id: group.id }).increment('sort_order', 1);
  await knex('menu_items').insert({ parent_id: group.id, title: 'User Summary', icon: 'users', route: ROUTE, scope: SCOPE, sort_order: 1, is_active: true });
};

exports.down = async function down(knex) {
  const row = await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).first('id', 'parent_id');
  if (!row) return;
  await knex('menu_items').where({ id: row.id }).del();
  await knex('menu_items').where({ parent_id: row.parent_id }).decrement('sort_order', 1);
};
