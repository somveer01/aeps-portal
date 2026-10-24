'use strict';

/** service_transactions.dmt_sender_id: the money-transfer sender whose monthly limit a transfer uses, so a transfer that later fails gives it back. */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('service_transactions', 'dmt_sender_id'))) {
    await knex.schema.alterTable('service_transactions', (t) => { t.integer('dmt_sender_id').references('id').inTable('dmt_senders').onDelete('SET NULL'); });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('service_transactions', 'dmt_sender_id')) await knex.schema.alterTable('service_transactions', (t) => { t.dropColumn('dmt_sender_id'); });
};
