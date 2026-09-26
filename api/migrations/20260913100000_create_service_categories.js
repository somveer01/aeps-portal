'use strict';

/** Service categories (e.g. "B2B Services", "Online Services") — a Modules screen. */
exports.up = async function up(knex) {
  await knex.schema.createTable('service_categories', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index(['is_active'], 'idx_service_cat_active');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('service_categories');
};
