'use strict';

/**
 * API Management: which external API (provider) each service runs through.
 *  - api_providers: the APIs we can call (name, code, adapter, endpoint, username, token - token and callback secret are
 *    stored ENCRYPTED by utils/secretBox.js, never in plain text). A "Mock Provider" row is added: with no other set-up
 *    every service keeps running exactly as before.
 *  - provider_products ("SP Keys"): per API x service x operator ('' = all operators) the product code we send to that API
 *    and what it pays us (percent / flat) or charges us (surcharge / surcharge_percent).
 *  - service_routes ("Product Switch"): the API a service uses. On / off of a service stays services.is_active.
 *  - user_service_routes ("Customer Switch"): one user's own API for a service. Allow / block of a service for a user stays
 *    user_service_overrides (Service Permissions), so there is one switch for it, not two.
 *  - service_transactions.provider_id / sp_key and admin_margins.provider_id / operator: which API a transaction used.
 *  - Admin menu group "API Management" right under General Settings with the four screens.
 * Reversible: `down` drops all of it (old transactions only lose the provider columns).
 */
const SCOPE = 'admin';
const GROUP = 'API Management';
const SCREENS = [
  ['API Configuration', 'api', '/modules/api-configuration', 1],
  ['SP Keys & Commission', 'key', '/modules/api-sp-keys', 2],
  ['Product Switch', 'services', '/modules/product-switch', 3],
  ['Customer Switch', 'users', '/modules/customer-switch', 4],
];

const idOf = (row) => (typeof row === 'object' ? row.id : row);

exports.up = async function up(knex) {
  await knex.schema.createTable('api_providers', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable();
    t.string('code', 40).notNullable().unique();
    t.string('adapter', 40).notNullable().defaultTo('mock');
    t.string('base_url', 500);
    t.string('username', 150);
    t.text('secret_enc');
    t.string('secret_hint', 8); // last 4 characters, for the masked "••••1234"
    t.text('extra_enc'); // other keys an adapter may need (JSON, encrypted)
    t.text('callback_secret_enc');
    t.text('description');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('provider_products', (t) => {
    t.increments('id').primary();
    t.integer('provider_id').notNullable().references('id').inTable('api_providers').onDelete('CASCADE');
    t.integer('service_id').notNullable().references('id').inTable('services').onDelete('CASCADE');
    t.string('operator', 80).notNullable().defaultTo('');
    t.string('sp_key', 100);
    t.string('commission_type', 20).notNullable().defaultTo('percent'); // percent | flat | surcharge | surcharge_percent
    t.decimal('commission_value', 12, 4).notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['provider_id', 'service_id', 'operator']);
  });

  await knex.schema.createTable('service_routes', (t) => {
    t.increments('id').primary();
    t.integer('service_id').notNullable().unique().references('id').inTable('services').onDelete('CASCADE');
    t.integer('provider_id').notNullable().references('id').inTable('api_providers');
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('user_service_routes', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('service_id').notNullable().references('id').inTable('services').onDelete('CASCADE');
    t.integer('provider_id').notNullable().references('id').inTable('api_providers');
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['user_id', 'service_id']);
  });

  await knex.schema.alterTable('service_transactions', (t) => {
    t.integer('provider_id').references('id').inTable('api_providers').onDelete('SET NULL');
    t.string('sp_key', 100);
  });
  await knex.schema.alterTable('admin_margins', (t) => {
    t.integer('provider_id').references('id').inTable('api_providers').onDelete('SET NULL');
    t.string('operator', 80);
  });

  await knex('api_providers').insert({
    name: 'Mock Provider', code: 'MOCK', adapter: 'mock', is_active: true,
    description: 'Built-in demo provider. Answers every request with test data and moves no real money.',
  });

  // Menu group right under General Settings: every later top-level admin item moves down one place.
  const settings = await knex('menu_items').where({ scope: SCOPE, title: 'General Settings' }).whereNull('parent_id').first('sort_order');
  const at = settings ? settings.sort_order + 1 : 3;
  await knex('menu_items').where({ scope: SCOPE }).whereNull('parent_id').where('sort_order', '>=', at).increment('sort_order', 1);
  const [g] = await knex('menu_items')
    .insert({ parent_id: null, title: GROUP, icon: 'api', route: null, scope: SCOPE, sort_order: at, is_active: true }).returning('id');
  await knex('menu_items').insert(SCREENS.map(([title, icon, route, sort]) => ({
    parent_id: idOf(g), title, icon, route, scope: SCOPE, sort_order: sort, is_active: true,
  })));
};

exports.down = async function down(knex) {
  const g = await knex('menu_items').where({ scope: SCOPE, title: GROUP }).whereNull('parent_id').first('id', 'sort_order');
  if (g) {
    await knex('menu_items').where({ parent_id: g.id }).del();
    await knex('menu_items').where({ id: g.id }).del();
    await knex('menu_items').where({ scope: SCOPE }).whereNull('parent_id').where('sort_order', '>', g.sort_order).decrement('sort_order', 1);
  }
  await knex.schema.alterTable('admin_margins', (t) => { t.dropColumn('provider_id'); t.dropColumn('operator'); });
  await knex.schema.alterTable('service_transactions', (t) => { t.dropColumn('provider_id'); t.dropColumn('sp_key'); });
  await knex.schema.dropTable('user_service_routes');
  await knex.schema.dropTable('service_routes');
  await knex.schema.dropTable('provider_products');
  await knex.schema.dropTable('api_providers');
};
