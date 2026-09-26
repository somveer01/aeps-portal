'use strict';

/** Application Banners + Ticket Departments (support). */
exports.up = async function up(knex) {
  await knex.schema.createTable('application_banners', (t) => {
    t.increments('id').primary();
    t.string('title', 150).notNullable();
    t.string('image', 255).nullable();
    t.string('link', 255).nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('ticket_departments', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('application_banners');
  await knex.schema.dropTableIfExists('ticket_departments');
};
