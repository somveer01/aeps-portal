'use strict';

/** Announcements target a user type and no longer require a title (per recording). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('announcements', (t) => {
    t.integer('user_type_id').nullable().references('id').inTable('user_types').onDelete('CASCADE');
    t.string('title', 200).nullable().alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('announcements', (t) => {
    t.dropColumn('user_type_id');
  });
};
