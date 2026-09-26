'use strict';

/** Announcements shown to users. */
exports.up = async function up(knex) {
  await knex.schema.createTable('announcements', (t) => {
    t.increments('id').primary();
    t.string('title', 200).notNullable();
    t.text('message').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('announcements');
};
