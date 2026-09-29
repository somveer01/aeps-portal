'use strict';

/**
 * Fund requests from any managed user (retailer, distributor, master distributor).
 * The user who created the requester approves it (approver_id = users.created_by,
 * the admin when unknown). receipt_no holds the UTR / reference number, unique among
 * requests that are pending or approved.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('fund_requests', (t) => {
    t.integer('approver_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.integer('acted_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('acted_at').nullable();
    t.index(['approver_id', 'status'], 'idx_fr_approver_status');
  });

  const admin = await knex('users').where({ role: 'admin' }).orderBy('id').first('id');
  await knex.raw(`
    update fund_requests fr set approver_id = coalesce(u.created_by, ?)
    from users u where u.id = fr.user_id and fr.approver_id is null`, [admin ? admin.id : null]);

  await knex.raw(`create unique index if not exists uq_fr_receipt_open on fund_requests (upper(trim(receipt_no)))
    where receipt_no is not null and trim(receipt_no) <> '' and status in ('pending', 'approved')`);

  if (!(await knex('menu_items').where({ route: '/fund-request' }).first())) {
    await knex('menu_items').insert({ parent_id: null, title: 'Fund Request', icon: 'fund', route: '/fund-request', sort_order: 2, scope: 'retailer', is_active: true });
  }
  const netUsers = await knex('menu_items').where({ route: '/network/users' }).first('parent_id');
  if (netUsers && !(await knex('menu_items').where({ route: '/network/fund-requests' }).first())) {
    await knex('menu_items').insert({ parent_id: netUsers.parent_id, title: 'Fund Requests', icon: 'fund', route: '/network/fund-requests', sort_order: 5, scope: 'network', is_active: true });
  }
};

exports.down = async function down(knex) {
  await knex('menu_items').whereIn('route', ['/fund-request', '/network/fund-requests']).del();
  await knex.raw('drop index if exists uq_fr_receipt_open');
  await knex.schema.alterTable('fund_requests', (t) => {
    t.dropIndex(['approver_id', 'status'], 'idx_fr_approver_status');
    t.dropColumn('acted_at');
    t.dropColumn('acted_by');
    t.dropColumn('approver_id');
  });
};
