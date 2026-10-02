'use strict';

/**
 * Commission packages: a Super Distributor / Distributor re-shares its own commission with
 * its DIRECT downline. The admin's Commission Slots stay the default; a package item sets
 * the child's credit commission for a service, and the difference comes out of (or goes back
 * to) the package owner's share — the admin's total cost for a transaction never changes.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('commission_packages', (t) => {
    t.increments('id').primary();
    t.integer('owner_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 80).notNullable();
    t.integer('user_type_id').notNullable().references('id').inTable('user_types').onDelete('CASCADE'); // the child type it is for
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['owner_user_id', 'name']);
  });
  await knex.schema.createTable('commission_package_items', (t) => {
    t.increments('id').primary();
    t.integer('package_id').notNullable().references('id').inTable('commission_packages').onDelete('CASCADE');
    t.integer('service_id').notNullable().references('id').inTable('services').onDelete('CASCADE');
    t.string('operator', 60).nullable(); // null = every operator / mode
    t.string('commission_type', 20).notNullable().defaultTo('percentage'); // percentage | amount
    t.decimal('value', 12, 2).notNullable().defaultTo(0);
    t.index(['package_id'], 'idx_cpi_package');
  });
  // One item per (package, service, operator); null operator counts as one value.
  await knex.raw("create unique index uq_cpi_service_operator on commission_package_items (package_id, service_id, coalesce(lower(operator), ''))");
  await knex.schema.alterTable('users', (t) => {
    t.integer('commission_package_id').nullable().references('id').inTable('commission_packages').onDelete('SET NULL');
  });

  const network = await knex('menu_items').where({ title: 'My Network', scope: 'network' }).whereNull('parent_id').first('id');
  if (network && !(await knex('menu_items').where({ route: '/network/packages' }).first('id'))) {
    await knex('menu_items').insert({ parent_id: network.id, title: 'Commission Packages', icon: 'commission', route: '/network/packages', sort_order: 6, scope: 'network', is_active: true });
  }
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ route: '/network/packages' }).del();
  await knex.schema.alterTable('users', (t) => { t.dropColumn('commission_package_id'); });
  await knex.schema.dropTableIfExists('commission_package_items');
  await knex.schema.dropTableIfExists('commission_packages');
};
