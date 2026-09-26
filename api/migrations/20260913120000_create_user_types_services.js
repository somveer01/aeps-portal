'use strict';

/** User Type Master + Service Master (services belong to a service category). */
exports.up = async function up(knex) {
  await knex.schema.createTable('user_types', (t) => {
    t.increments('id').primary();
    t.string('name', 80).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('services', (t) => {
    t.increments('id').primary();
    t.string('title', 120).notNullable();
    t.integer('service_category_id').notNullable().references('id').inTable('service_categories').onDelete('RESTRICT');
    t.string('service_type', 20).notNullable().defaultTo('internal'); // internal | external
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['title']);
    t.index(['service_category_id'], 'idx_service_cat');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('services');
  await knex.schema.dropTableIfExists('user_types');
};
