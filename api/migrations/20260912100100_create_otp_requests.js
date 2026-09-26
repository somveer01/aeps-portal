'use strict';

/**
 * OTPs issued for login (second factor). The OTP itself is stored hashed.
 * The daily send limit is derived by counting rows per user per calendar day.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('otp_requests', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('otp_hash', 255).notNullable();
    t.string('purpose', 30).notNullable().defaultTo('login');
    t.timestamp('expires_at').notNullable();
    t.integer('verify_attempts').notNullable().defaultTo(0);
    t.timestamp('consumed_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['user_id', 'created_at'], 'idx_otp_user_created');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('otp_requests');
};
