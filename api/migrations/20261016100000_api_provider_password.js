'use strict';

/**
 * API Configuration gets a PASSWORD next to the username (some partners give a login + password besides, or instead of,
 * a token). Stored encrypted by utils/secretBox.js like the token; screens only learn "a password is saved", never the value.
 * Reversible: `down` drops the column.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('api_providers', (t) => { t.text('password_enc'); });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('api_providers', (t) => { t.dropColumn('password_enc'); });
};
