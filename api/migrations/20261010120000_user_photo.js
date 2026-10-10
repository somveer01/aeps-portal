'use strict';

// Profile photo of a user (an /uploads/... path set from My Profile). Null = the app shows initials.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('photo', 255).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('photo');
  });
};
