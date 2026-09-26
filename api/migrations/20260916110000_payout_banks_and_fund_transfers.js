'use strict';

/** Payout Banks (user payout accounts, admin-approved) + Fund Transfers (admin→user). */
exports.up = async function up(knex) {
  await knex.schema.createTable('payout_banks', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('bank_name', 150).notNullable();
    t.string('account_no', 40).notNullable();
    t.string('ifsc_code', 20).notNullable();
    t.string('ac_holder', 150).notNullable();
    t.string('passbook', 255); // uploaded image path
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.text('remark');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status', 'created_at'], 'idx_payout_status_date');
    t.index(['user_id'], 'idx_payout_user');
  });

  await knex.schema.createTable('fund_transfers', (t) => {
    t.increments('id').primary();
    t.integer('from_user_id').nullable().references('id').inTable('users').onDelete('SET NULL'); // admin performing it
    t.integer('to_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.decimal('amount', 14, 2).notNullable();
    t.string('transfer_type', 10).notNullable().defaultTo('credit'); // credit | debit (on receiver wallet)
    t.text('remark');
    t.decimal('before_balance', 14, 2).notNullable().defaultTo(0);
    t.decimal('updated_balance', 14, 2).notNullable().defaultTo(0);
    t.string('status', 20).notNullable().defaultTo('success');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['to_user_id', 'created_at'], 'idx_ft_to_date');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fund_transfers');
  await knex.schema.dropTableIfExists('payout_banks');
};
