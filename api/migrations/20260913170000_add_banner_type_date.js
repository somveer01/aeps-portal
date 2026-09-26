'use strict';

/** Application banner: type (placement) + a date (valid till / display date). */
exports.up = async function up(knex) {
  await knex.schema.alterTable('application_banners', (t) => {
    t.string('type', 30).notNullable().defaultTo('both'); // web | mobile | both
    t.date('banner_date').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('application_banners', (t) => {
    t.dropColumn('type');
    t.dropColumn('banner_date');
  });
};
