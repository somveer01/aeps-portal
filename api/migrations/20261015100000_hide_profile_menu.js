'use strict';

/**
 * The separate "My Profile" page is gone: the account popover (avatar chip) now shows the signed-in user's details and
 * Sign out, and the admin edits their own name / email there. This hides the retailer-panel sidebar row that pointed at
 * /profile (managed users: retailer, distributor, super distributor, employees). The row is kept (is_active = false),
 * so `down` brings it back. The /api/account/profile API stays (the popover and header use it).
 */
const ROW = { scope: 'retailer', route: '/profile' };

exports.up = async function up(knex) {
  await knex('menu_items').where(ROW).update({ is_active: false });
};

exports.down = async function down(knex) {
  await knex('menu_items').where(ROW).update({ is_active: true });
};
