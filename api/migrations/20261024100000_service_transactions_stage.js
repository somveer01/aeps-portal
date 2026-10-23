'use strict';

/**
 * service_transactions.stage - where a PENDING transaction is in its life, so a crash or a timeout can be told apart from
 * "the provider is processing it":
 *   'initiated' - the wallet is debited and the row written, the provider call has not finished (or the server died during it);
 *   'unknown'   - the provider call ended without a definite answer (timeout / network error): the money stays held;
 *   null        - settled, or the provider itself answered "pending".
 * The status-check job asks the provider about 'initiated' (after a few minutes) and 'unknown' rows; "not found" there means the
 * request never arrived, so it is refunded. Reversible.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('service_transactions', 'stage')) return;
  await knex.schema.alterTable('service_transactions', (t) => { t.string('stage', 20); });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('service_transactions', 'stage'))) return;
  await knex.schema.alterTable('service_transactions', (t) => { t.dropColumn('stage'); });
};
