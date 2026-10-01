'use strict';

/**
 * Users of a top-level account type (no Parent Type, e.g. Super Distributor) sit directly
 * under the admin. Backfill existing ones so the chain and fund-request approver line up.
 */
exports.up = async function up(knex) {
  const admin = await knex('users').where({ role: 'admin' }).orderBy('id').first('id');
  if (!admin) return;
  await knex('users')
    .whereIn('user_type_id', knex('user_types').whereNull('parent_type_id').select('id'))
    .whereNot({ role: 'admin' })
    .where((w) => w.whereNull('parent_id').orWhereNot('parent_id', admin.id))
    .update({ parent_id: admin.id, updated_at: knex.fn.now() });
};

// Old parents are not recorded, so there is nothing to restore.
exports.down = async function down() {};
