'use strict';

/**
 * Retailer panel foundation (spec 02 / TDD 03):
 *  - menu_items.scope : 'admin' | 'retailer' | 'both' — role-scoped sidebar.
 *  - operators        : recharge/DTH/BBPS/gas/fastag operators.
 *  - dmt_senders / dmt_beneficiaries : DMT (money transfer).
 *  - bookings         : flight/hotel/bus.
 */
exports.up = async function up(knex) {
  const hasScope = await knex.schema.hasColumn('menu_items', 'scope');
  if (!hasScope) {
    await knex.schema.alterTable('menu_items', (t) => { t.string('scope', 20).notNullable().defaultTo('admin'); });
    await knex('menu_items').update({ scope: 'admin' }); // backfill existing = admin
  }

  if (!(await knex.schema.hasTable('operators'))) {
    await knex.schema.createTable('operators', (t) => {
      t.increments('id').primary();
      t.string('service', 60).notNullable();       // mobile | dth | bbps | gas | fastag
      t.string('category', 60);                     // Electricity, Insurance, Prepaid, DTH…
      t.string('name', 120).notNullable();
      t.string('code', 60);
      t.boolean('circle_required').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['service', 'category'], 'idx_operators_service');
    });
  }

  if (!(await knex.schema.hasTable('dmt_senders'))) {
    await knex.schema.createTable('dmt_senders', (t) => {
      t.increments('id').primary();
      t.integer('retailer_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('mobile', 15).notNullable();
      t.string('name', 120);
      t.string('kyc_status', 20).notNullable().defaultTo('verified'); // mock verifies
      t.decimal('monthly_limit', 14, 2).notNullable().defaultTo(25000);
      t.decimal('used_limit', 14, 2).notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['retailer_id', 'mobile'], 'uq_sender_retailer_mobile');
    });
  }

  if (!(await knex.schema.hasTable('dmt_beneficiaries'))) {
    await knex.schema.createTable('dmt_beneficiaries', (t) => {
      t.increments('id').primary();
      t.integer('sender_id').notNullable().references('id').inTable('dmt_senders').onDelete('CASCADE');
      t.string('name', 120).notNullable();
      t.string('bank_name', 120).notNullable();
      t.string('account_no', 40).notNullable();
      t.string('ifsc', 20).notNullable();
      t.boolean('verified').notNullable().defaultTo(false);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['sender_id'], 'idx_benef_sender');
    });
  }

  if (!(await knex.schema.hasTable('bookings'))) {
    await knex.schema.createTable('bookings', (t) => {
      t.increments('id').primary();
      t.integer('retailer_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('type', 10).notNullable(); // flight | hotel | bus
      t.string('pnr', 40);
      t.jsonb('pax');
      t.decimal('amount', 14, 2).notNullable().defaultTo(0);
      t.string('status', 20).notNullable().defaultTo('booked');
      t.string('provider_ref', 80);
      t.jsonb('detail');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['retailer_id', 'created_at'], 'idx_bookings_retailer');
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('bookings');
  await knex.schema.dropTableIfExists('dmt_beneficiaries');
  await knex.schema.dropTableIfExists('dmt_senders');
  await knex.schema.dropTableIfExists('operators');
  const hasScope = await knex.schema.hasColumn('menu_items', 'scope');
  if (hasScope) await knex.schema.alterTable('menu_items', (t) => { t.dropColumn('scope'); });
};
