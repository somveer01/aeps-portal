'use strict';

/**
 * Drives the dynamic left navigation panel. Self-referencing parent_id
 * supports nested (multi-level) menus. Admin changes the menu by editing
 * these rows — no code change required.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('menu_items', (t) => {
    t.increments('id').primary();
    t.integer('parent_id').nullable().references('id').inTable('menu_items').onDelete('CASCADE');
    t.string('title', 120).notNullable();
    t.string('icon', 60).nullable();
    t.string('route', 200).nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['parent_id', 'sort_order'], 'idx_menu_parent_sort');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('menu_items');
};
