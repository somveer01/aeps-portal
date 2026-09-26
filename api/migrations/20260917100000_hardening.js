'use strict';

/**
 * Security & integrity hardening (spec §14):
 *  - users.token_epoch : bump to revoke all existing access tokens (logout / password change).
 *  - users.txn_pin_hash: optional separate transaction PIN (falls back to login password).
 *  - idempotency_keys   : dedupe money-mutating POSTs by (user, key).
 *  - drop legacy `session` table (cookie sessions were replaced by JWT).
 */
exports.up = async function up(knex) {
  const hasEpoch = await knex.schema.hasColumn('users', 'token_epoch');
  const hasPin = await knex.schema.hasColumn('users', 'txn_pin_hash');
  await knex.schema.alterTable('users', (t) => {
    if (!hasEpoch) t.integer('token_epoch').notNullable().defaultTo(0);
    if (!hasPin) t.string('txn_pin_hash', 100);
  });

  const hasIdem = await knex.schema.hasTable('idempotency_keys');
  if (!hasIdem) {
    await knex.schema.createTable('idempotency_keys', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('idem_key', 100).notNullable();
      t.string('endpoint', 120).notNullable();
      t.integer('response_status').notNullable();
      t.text('response_body'); // serialized JSON of the original response
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['user_id', 'idem_key'], 'uq_idem_user_key');
    });
  }

  await knex.schema.dropTableIfExists('session');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('idempotency_keys');
  const hasEpoch = await knex.schema.hasColumn('users', 'token_epoch');
  const hasPin = await knex.schema.hasColumn('users', 'txn_pin_hash');
  await knex.schema.alterTable('users', (t) => {
    if (hasEpoch) t.dropColumn('token_epoch');
    if (hasPin) t.dropColumn('txn_pin_hash');
  });
  // Recreate a minimal connect-pg-simple session table for rollback parity.
  const hasSession = await knex.schema.hasTable('session');
  if (!hasSession) {
    await knex.schema.createTable('session', (t) => {
      t.string('sid').notNullable().primary();
      t.json('sess').notNullable();
      t.timestamp('expire', { useTz: false }).notNullable();
    });
  }
};
