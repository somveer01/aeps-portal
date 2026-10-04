'use strict';

// Commission Report in the menus:
//  - admin: Reports -> Commission Report (/commission-report), every commission paid;
//  - managed users (scope 'retailer', shown to retailers, distributors and super distributors):
//    the row used to come only from seeds/10_retailer.js, so a database that never ran that seed
//    had no Commission Report. Both inserts are skipped when the row is already there.
exports.up = async function up(knex) {
  const reports = await knex('menu_items').where({ title: 'Reports', scope: 'admin' }).whereNull('parent_id').first('id');
  const adminRow = await knex('menu_items').where({ route: '/commission-report', scope: 'admin' }).first('id');
  if (!adminRow) {
    await knex('menu_items').insert({
      parent_id: reports ? reports.id : null, title: 'Commission Report', icon: 'report', route: '/commission-report',
      scope: 'admin', sort_order: 4, is_active: true,
    });
  }
  const retailerRow = await knex('menu_items').where({ route: '/commission-report', scope: 'retailer' }).first('id');
  if (!retailerRow) {
    await knex('menu_items').insert({ title: 'Commission Report', icon: 'report', route: '/commission-report', scope: 'retailer', sort_order: 8, is_active: true });
  }
};

exports.down = async function down(knex) {
  // The retailer row may predate this migration (seed), so only the admin row is removed.
  await knex('menu_items').where({ route: '/commission-report', scope: 'admin' }).del();
};
