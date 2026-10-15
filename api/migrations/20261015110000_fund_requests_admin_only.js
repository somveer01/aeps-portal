'use strict';

/**
 * Fund requests now go to the ADMIN only (owner's decision, 2026-10-15):
 *  - every PENDING request that still names a distributor / super distributor as approver is handed to the admin
 *    (it has no company bank picked; the admin checks it and approves or rejects). Approved / rejected rows are history
 *    and stay as they are;
 *  - the distributor-panel menu row "My Network -> Fund Requests" (/network/fund-requests) is hidden (kept, not deleted).
 * `down` brings the menu row back; the pending requests are not handed back (who approved what is not reversible here).
 */
const MENU = { scope: 'network', route: '/network/fund-requests' };

exports.up = async function up(knex) {
  const admin = await knex('users').where({ role: 'admin' }).orderBy('id').first('id');
  if (admin) {
    const nonAdmin = knex('users').whereNot({ role: 'admin' }).select('id');
    await knex('fund_requests').where({ status: 'pending' }).whereIn('approver_id', nonAdmin)
      .update({ approver_id: admin.id, updated_at: knex.fn.now() });
  }
  await knex('menu_items').where(MENU).update({ is_active: false });
};

exports.down = async function down(knex) {
  await knex('menu_items').where(MENU).update({ is_active: true });
};
