'use strict';

/** Optional "For Any Specific User" (a user login id) on a commission slot. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('commission_slots', (t) => {
    t.string('specific_user', 120).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('commission_slots', (t) => {
    t.dropColumn('specific_user');
  });
};
