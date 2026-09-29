'use strict';

/** Track who created each managed user (retailer/distributor/...). Separate from parent_id (the upline). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.index(['created_by'], 'idx_users_created_by');
  });
  // Only an admin could create managed users so far, so existing ones were created by the admin.
  const admin = await knex('users').where({ role: 'admin' }).orderBy('id').first('id');
  if (admin) await knex('users').whereNotNull('user_type_id').whereNull('created_by').update({ created_by: admin.id });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropIndex(['created_by'], 'idx_users_created_by');
    t.dropColumn('created_by');
  });
};
