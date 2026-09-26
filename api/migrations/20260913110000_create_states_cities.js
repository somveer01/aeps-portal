'use strict';

/**
 * States and Cities master data. Cities belong to a state. This data is shared
 * across the app (City Master screen + state/city dropdowns on other screens).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('states', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('cities', (t) => {
    t.increments('id').primary();
    t.integer('state_id').notNullable().references('id').inTable('states').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['state_id', 'name']);
    t.index(['name'], 'idx_city_name');
    t.index(['state_id'], 'idx_city_state');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('cities');
  await knex.schema.dropTableIfExists('states');
};
