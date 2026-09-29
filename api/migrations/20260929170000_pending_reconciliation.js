'use strict';

/**
 * Pending transactions, provider callbacks, status checks and daily reconciliation.
 *  - service_transactions gains our own unique client_ref (sent to the provider, used by
 *    callbacks), what was debited (so a late failure refunds exactly that) and settlement
 *    bookkeeping.
 *  - reconciliation_runs / reconciliation_items: each run compares one day of our
 *    transactions with the provider's report; mismatches stay open until an admin resolves.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('service_transactions', (t) => {
    t.string('client_ref', 40).nullable().unique();
    t.decimal('debit_amount', 14, 2).nullable();
    t.decimal('service_charge', 14, 2).notNullable().defaultTo(0);
    t.string('mode', 20).nullable();
    t.integer('check_count').notNullable().defaultTo(0);
    t.timestamp('last_checked_at').nullable();
    t.timestamp('finalized_at').nullable();
    t.string('finalized_by', 20).nullable(); // callback | status_check | reconciliation | admin
    t.text('final_note').nullable();
  });
  await knex.raw("create index if not exists idx_svc_txn_pending on service_transactions (created_at) where status = 'pending'");

  await knex.schema.createTable('reconciliation_runs', (t) => {
    t.increments('id').primary();
    t.date('run_date').notNullable();
    t.string('status', 20).notNullable().defaultTo('running'); // running | done | failed
    t.integer('total').notNullable().defaultTo(0);
    t.integer('matched').notNullable().defaultTo(0);
    t.integer('mismatched').notNullable().defaultTo(0);
    t.integer('auto_fixed').notNullable().defaultTo(0);
    t.text('error').nullable();
    t.integer('run_by').nullable().references('id').inTable('users').onDelete('SET NULL'); // null = scheduler
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at').nullable();
    t.index(['run_date'], 'idx_recon_runs_date');
  });

  await knex.schema.createTable('reconciliation_items', (t) => {
    t.increments('id').primary();
    t.integer('run_id').notNullable().references('id').inTable('reconciliation_runs').onDelete('CASCADE');
    t.integer('service_transaction_id').nullable().references('id').inTable('service_transactions').onDelete('SET NULL');
    t.string('client_ref', 40).nullable();
    t.string('type', 30).notNullable(); // STATUS_MISMATCH | AMOUNT_MISMATCH | MISSING_AT_PROVIDER | MISSING_AT_OURS | AUTO_FINALIZED
    t.string('our_status', 20).nullable();
    t.string('provider_status', 20).nullable();
    t.decimal('our_amount', 14, 2).nullable();
    t.decimal('provider_amount', 14, 2).nullable();
    t.string('state', 20).notNullable().defaultTo('open'); // open | resolved | auto
    t.text('note').nullable();
    t.integer('resolved_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('resolved_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['run_id', 'state'], 'idx_recon_items_run');
  });

  const rows = [
    { title: 'Pending Transactions', route: '/pending-transactions', sort_order: 6 },
    { title: 'Reconciliation', route: '/reconciliation', sort_order: 6 },
  ];
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex('menu_items').where({ route: r.route }).first())) {
      // eslint-disable-next-line no-await-in-loop
      await knex('menu_items').insert({ ...r, parent_id: null, icon: 'report', scope: 'admin', is_active: true });
    }
  }
};

exports.down = async function down(knex) {
  await knex('menu_items').whereIn('route', ['/pending-transactions', '/reconciliation']).del();
  await knex.schema.dropTableIfExists('reconciliation_items');
  await knex.schema.dropTableIfExists('reconciliation_runs');
  await knex.raw('drop index if exists idx_svc_txn_pending');
  await knex.schema.alterTable('service_transactions', (t) => {
    ['final_note', 'finalized_by', 'finalized_at', 'last_checked_at', 'check_count', 'mode', 'service_charge', 'debit_amount'].forEach((c) => t.dropColumn(c));
    t.dropUnique(['client_ref']);
    t.dropColumn('client_ref');
  });
};
