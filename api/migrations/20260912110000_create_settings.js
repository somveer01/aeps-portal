'use strict';

/** Key/value store for portal settings (e.g. the login banner image path). */
exports.up = async function up(knex) {
  await knex.schema.createTable('settings', (t) => {
    t.string('key', 80).primary();
    t.text('value');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('settings');
};
