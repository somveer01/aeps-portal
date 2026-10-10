'use strict';

// Set when an admin resets a user's password: the temporary password only gets the user to the Change Password
// screen (see middleware/auth.js); changing the password clears it.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('must_change_password').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('must_change_password');
  });
};
