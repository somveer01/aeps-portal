'use strict';

/** Support Ticketing — retailer raises complaints, admin resolves them. */
exports.up = async function up(knex) {
  await knex.schema.createTable('tickets', (t) => {
    t.increments('id').primary();
    t.string('ticket_no', 40).notNullable().unique();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('department_id').notNullable().references('id').inTable('ticket_departments').onDelete('RESTRICT');
    t.string('subject', 150).notNullable();
    t.text('description').notNullable();
    t.string('priority', 10).notNullable().defaultTo('medium'); // low | medium | high
    t.string('status', 20).notNullable().defaultTo('open'); // open | in_progress | resolved | closed
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at'], 'idx_tickets_user_date');
    t.index(['status'], 'idx_tickets_status');
  });

  await knex.schema.createTable('ticket_replies', (t) => {
    t.increments('id').primary();
    t.integer('ticket_id').notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.integer('sender_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('sender_role', 10).notNullable(); // admin | retailer
    t.text('message').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['ticket_id', 'created_at'], 'idx_replies_ticket_date');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ticket_replies');
  await knex.schema.dropTableIfExists('tickets');
};
