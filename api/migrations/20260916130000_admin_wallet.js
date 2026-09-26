'use strict';

/** Admin Wallet ledger — the admin tops up / adjusts their own wallet pool. */
exports.up = async function up(knex) {
  await knex.schema.createTable('admin_wallet_transactions', (t) => {
    t.increments('id').primary();
    t.integer('admin_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.decimal('amount', 14, 2).notNullable();
    t.string('txn_type', 10).notNullable().defaultTo('credit'); // credit | debit
    t.text('remark');
    t.decimal('before_balance', 14, 2).notNullable().defaultTo(0);
    t.decimal('updated_balance', 14, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['admin_id', 'created_at'], 'idx_admin_wallet_date');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('admin_wallet_transactions');
};
