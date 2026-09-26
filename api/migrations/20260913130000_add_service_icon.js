'use strict';

/** Optional per-service icon image (stored as an /uploads/... path). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('services', (t) => {
    t.string('icon', 255).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('services', (t) => {
    t.dropColumn('icon');
  });
};
