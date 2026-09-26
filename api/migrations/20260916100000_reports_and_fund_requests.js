'use strict';

/** Account History (ledger), Service Report (service txns), Fund Requests. */
exports.up = async function up(knex) {
  await knex.schema.createTable('account_transactions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('service_name', 120).notNullable();
    t.string('type', 10).notNullable(); // credit | debit
    t.text('remark');
    t.decimal('amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('before_balance', 14, 2).notNullable().defaultTo(0);
    t.decimal('updated_balance', 14, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at'], 'idx_acct_txn_user_date');
  });

  await knex.schema.createTable('service_transactions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('service', 120).notNullable();
    t.string('operator', 80);
    t.string('target', 60);       // mobile/account number recharged
    t.decimal('amount', 14, 2).notNullable().defaultTo(0);
    t.string('reference_id', 80);
    t.string('status', 20).notNullable().defaultTo('success'); // success | failed | pending
    t.text('response');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at'], 'idx_svc_txn_user_date');
    t.index(['service'], 'idx_svc_txn_service');
  });

  await knex.schema.createTable('fund_requests', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('company_bank_id').nullable().references('id').inTable('company_banks').onDelete('SET NULL');
    t.date('deposit_date');
    t.string('payment_mode', 30);   // NEFT | IMPS | RTGS | UPI | Cash | Cheque
    t.decimal('amount', 14, 2).notNullable().defaultTo(0);
    t.string('request_id', 40).notNullable().unique();
    t.string('receipt_no', 60);
    t.string('receipt_img', 255);
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.text('remark');
    t.text('admin_remark');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status', 'created_at'], 'idx_fr_status_date');
    t.index(['user_id'], 'idx_fr_user');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fund_requests');
  await knex.schema.dropTableIfExists('service_transactions');
  await knex.schema.dropTableIfExists('account_transactions');
};
