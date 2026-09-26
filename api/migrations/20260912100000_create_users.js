'use strict';

/** Admin/portal users. */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 60).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('full_name', 120);
    t.string('mobile', 20).notNullable();
    t.string('email', 160);
    t.string('role', 40).notNullable().defaultTo('admin');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('users');
};
