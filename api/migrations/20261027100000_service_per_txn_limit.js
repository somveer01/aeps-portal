'use strict';

/**
 * services.per_txn_limit: the most ONE transaction of this service may be (0 = no limit), set in Service Master.
 * The three cash-out screens (AEPS, Aadhar Pay, Micro ATM) start at Rs 10,000 per transaction; the admin can change or clear it.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('services', 'per_txn_limit'))) {
    await knex.schema.alterTable('services', (t) => { t.decimal('per_txn_limit', 14, 2).notNullable().defaultTo(0); });
  }
  await knex('services').whereIn('screen', ['aeps', 'aadhar-pay', 'micro-atm']).where({ per_txn_limit: 0 }).update({ per_txn_limit: 10000 });
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('services', 'per_txn_limit')) await knex.schema.alterTable('services', (t) => { t.dropColumn('per_txn_limit'); });
};
