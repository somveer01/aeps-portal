'use strict';

/**
 * Chain commission: each commission_ledger row records whose transaction earned it
 * (source_user_id), how far up the parent chain the earner is (level: 0 = self,
 * 1 = parent, 2 = grand-parent ...) and the service transaction it came from.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('commission_ledger', (t) => {
    t.integer('level').notNullable().defaultTo(0);
    t.integer('source_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.integer('service_transaction_id').nullable().references('id').inTable('service_transactions').onDelete('SET NULL');
    t.index(['source_user_id'], 'idx_comm_ledger_source');
    t.index(['service_transaction_id'], 'idx_comm_ledger_svc_txn');
  });
  // Every existing row was earned on the user's own transaction.
  await knex('commission_ledger').whereNull('source_user_id').update({ source_user_id: knex.ref('user_id') });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('commission_ledger', (t) => {
    t.dropIndex(['source_user_id'], 'idx_comm_ledger_source');
    t.dropIndex(['service_transaction_id'], 'idx_comm_ledger_svc_txn');
    t.dropColumn('service_transaction_id');
    t.dropColumn('source_user_id');
    t.dropColumn('level');
  });
};
