'use strict';

/** The admin menu row "View All" (Fund Management) is called "Admin Wallet Statement": it is the Admin Wallet's history as a statement. Only the menu title changes. */
const ROUTE = '/admin-wallet/all';

exports.up = async function up(knex) {
  await knex('menu_items').where({ scope: 'admin', route: ROUTE }).update({ title: 'Admin Wallet Statement' });
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ scope: 'admin', route: ROUTE }).update({ title: 'View All' });
};
