'use strict';

/** Company Banks table + extra fields on users for the Users Manager. */
exports.up = async function up(knex) {
  await knex.schema.createTable('company_banks', (t) => {
    t.increments('id').primary();
    t.string('bank_name', 150).notNullable();
    t.string('account_holder', 150).notNullable();
    t.string('account_no', 40).notNullable();
    t.string('ifsc_code', 20).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('users', (t) => {
    t.string('user_code', 40).nullable().unique(); // displayed "User Id" e.g. DAC0159
    t.string('shop_name', 150).nullable();
    t.integer('user_type_id').nullable().references('id').inTable('user_types').onDelete('SET NULL');
    t.decimal('wallet_balance', 14, 2).notNullable().defaultTo(0);
    t.integer('plan_id').nullable().references('id').inTable('plans').onDelete('SET NULL');
    t.integer('parent_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('kyc_status', 20).notNullable().defaultTo('pending'); // pending|verified|rejected
    t.string('ekyc_status', 20).notNullable().defaultTo('pending');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('user_code'); t.dropColumn('shop_name'); t.dropColumn('user_type_id');
    t.dropColumn('wallet_balance'); t.dropColumn('plan_id'); t.dropColumn('parent_id');
    t.dropColumn('kyc_status'); t.dropColumn('ekyc_status');
  });
  await knex.schema.dropTableIfExists('company_banks');
};
