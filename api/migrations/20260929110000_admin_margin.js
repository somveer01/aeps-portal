'use strict';

/**
 * Admin margin: what the API provider pays the company per service (set on the
 * service), and one admin_margins row per successful transaction:
 *   margin = provider commission + charges collected from the user − commission paid out.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('services', (t) => {
    t.string('provider_commission_type', 20).notNullable().defaultTo('percentage'); // percentage | amount
    t.decimal('provider_commission_value', 12, 2).notNullable().defaultTo(0);
  });

  await knex.schema.createTable('admin_margins', (t) => {
    t.increments('id').primary();
    t.integer('service_transaction_id').nullable().references('id').inTable('service_transactions').onDelete('SET NULL');
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE'); // who did the transaction
    t.string('service_name', 120).notNullable();
    t.decimal('amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('provider_commission', 14, 2).notNullable().defaultTo(0);
    t.decimal('charges_collected', 14, 2).notNullable().defaultTo(0);
    t.decimal('commission_paid', 14, 2).notNullable().defaultTo(0);
    t.decimal('margin', 14, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_at'], 'idx_admin_margins_date');
    t.index(['user_id'], 'idx_admin_margins_user');
  });

  const exists = await knex('menu_items').where({ route: '/admin-margin' }).first();
  if (!exists) {
    await knex('menu_items').insert({ parent_id: null, title: 'Admin Margin', icon: 'report', route: '/admin-margin', sort_order: 13, scope: 'admin', is_active: true });
  }
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ route: '/admin-margin' }).del();
  await knex.schema.dropTableIfExists('admin_margins');
  await knex.schema.alterTable('services', (t) => {
    t.dropColumn('provider_commission_value');
    t.dropColumn('provider_commission_type');
  });
};
