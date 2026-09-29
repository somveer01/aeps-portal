'use strict';

/** Per-user daily amount limit for each service (0 = no limit). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('services', (t) => {
    t.decimal('daily_limit', 14, 2).notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('services', (t) => { t.dropColumn('daily_limit'); });
};
