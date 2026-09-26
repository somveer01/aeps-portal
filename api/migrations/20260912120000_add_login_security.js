'use strict';

/**
 * Adds per-account brute-force lockout fields and an immutable audit log of
 * authentication events (fintech requirement).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.integer('failed_login_attempts').notNullable().defaultTo(0);
    t.timestamp('locked_until').nullable();
    t.timestamp('last_login_at').nullable();
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.bigIncrements('id').primary();
    t.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('username', 120).nullable(); // captured even for unknown-user attempts
    t.string('event', 60).notNullable(); // e.g. login_success, login_failed, account_locked
    t.string('ip', 64).nullable();
    t.string('user_agent', 300).nullable();
    t.jsonb('detail').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['event', 'created_at'], 'idx_audit_event_created');
    t.index(['user_id', 'created_at'], 'idx_audit_user_created');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('failed_login_attempts');
    t.dropColumn('locked_until');
    t.dropColumn('last_login_at');
  });
};
