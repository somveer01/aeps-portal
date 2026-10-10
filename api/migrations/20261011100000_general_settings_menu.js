'use strict';

/**
 * Admin left-menu: a "General Settings" group right under Dashboard that holds the screens an admin sets up BEFORE onboarding users:
 * user types, plans, services (category / master / permissions) and commission slots. The screens are MOVED here (re-parented), not
 * copied, so each one shows once and only one menu row is highlighted. No route or screen changes: menus are data (menu_items -> GET /api/menu).
 *
 * Scope is pinned to 'admin'. Safe to run twice (the group is reused, the moves are idempotent).
 */
const SCOPE = 'admin';
const GROUP = 'General Settings';

// [route, order inside the group, the group it came from (for down())]
const ITEMS = [
  ['/modules/user-type-master', 1, 'User Management'],
  ['/modules/plan-master', 2, 'Masters & Configuration'],
  ['/modules/service-category', 3, 'User Management'],
  ['/modules/service-master', 4, 'User Management'],
  ['/modules/service-permissions', 5, 'User Management'],
  ['/modules/commission-slots', 6, 'Commission & Margin'],
];

const topGroup = (knex, title) => knex('menu_items').where({ scope: SCOPE, title }).whereNull('parent_id').first('id');

exports.up = async function up(knex) {
  let group = await topGroup(knex, GROUP);
  if (!group) {
    // Room right under Dashboard (sort 1): every other top-level admin item moves down one place.
    await knex('menu_items').where({ scope: SCOPE }).whereNull('parent_id').where('sort_order', '>=', 2).increment('sort_order', 1);
    const [row] = await knex('menu_items')
      .insert({ parent_id: null, title: GROUP, icon: 'settings', route: null, scope: SCOPE, sort_order: 2, is_active: true })
      .returning('id');
    group = { id: typeof row === 'object' ? row.id : row };
  }
  for (const [route, sort] of ITEMS) {
    await knex('menu_items').where({ scope: SCOPE, route }).update({ parent_id: group.id, sort_order: sort });
  }
};

exports.down = async function down(knex) {
  const group = await topGroup(knex, GROUP);
  if (!group) return;
  for (const [route, , from] of ITEMS) {
    const parent = await topGroup(knex, from);
    if (parent) await knex('menu_items').where({ scope: SCOPE, route }).update({ parent_id: parent.id });
  }
  await knex('menu_items').where({ id: group.id }).del();
  await knex('menu_items').where({ scope: SCOPE }).whereNull('parent_id').where('sort_order', '>', 2).decrement('sort_order', 1);
};
