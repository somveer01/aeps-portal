'use strict';

/** Plan Master + Commission Slots. */
exports.up = async function up(knex) {
  await knex.schema.createTable('plans', (t) => {
    t.increments('id').primary();
    t.integer('user_type_id').notNullable().references('id').inTable('user_types').onDelete('RESTRICT');
    t.string('name', 120).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_type_id'], 'idx_plan_user_type');
  });

  await knex.schema.createTable('commission_slots', (t) => {
    t.increments('id').primary();
    t.integer('user_type_id').notNullable().references('id').inTable('user_types').onDelete('RESTRICT');
    t.integer('service_id').notNullable().references('id').inTable('services').onDelete('RESTRICT');
    t.integer('plan_id').notNullable().references('id').inTable('plans').onDelete('CASCADE');
    t.string('operator', 60).nullable(); // e.g. Airtel, IMPS (optional sub-label)
    t.string('commission_type', 20).notNullable().defaultTo('percentage'); // percentage | amount
    t.decimal('min_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('max_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('value', 12, 2).notNullable().defaultTo(0); // % or Rs depending on commission_type
    t.string('chain_type', 20).notNullable().defaultTo('self'); // self | chain
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_type_id'], 'idx_cs_user_type');
    t.index(['service_id'], 'idx_cs_service');
    t.index(['plan_id'], 'idx_cs_plan');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('commission_slots');
  await knex.schema.dropTableIfExists('plans');
};
