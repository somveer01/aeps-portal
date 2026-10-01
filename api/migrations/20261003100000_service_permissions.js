'use strict';

/**
 * Service permissions, controlled by the admin:
 *   can(user, service) = service is on in Service Master
 *                        AND (the user's override, else the user type's default)
 * user_type_services   — a row means the type may use the service.
 * user_service_overrides — an explicit allow / block for one user.
 * Defaults: the "Retailer" type gets every service, other types none. Retailers keep their old
 * Service Access ticks (stored as overrides); everyone else follows the type default.
 * users.service_access is no longer read but kept so a rollback loses nothing.
 */
const NEW_SERVICES = [['UPI Collection', /^b2b/i], ['Fino CMS', /^b2b/i]];

exports.up = async function up(knex) {
  await knex.schema.createTable('user_type_services', (t) => {
    t.integer('user_type_id').notNullable().references('id').inTable('user_types').onDelete('CASCADE');
    t.integer('service_id').notNullable().references('id').inTable('services').onDelete('CASCADE');
    t.integer('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['user_type_id', 'service_id']);
  });
  await knex.schema.createTable('user_service_overrides', (t) => {
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('service_id').notNullable().references('id').inTable('services').onDelete('CASCADE');
    t.boolean('allowed').notNullable();
    t.integer('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'service_id']);
    t.index(['service_id'], 'idx_uso_service');
  });

  // Retailer-panel tiles that Service Master did not list yet, so they can be controlled too.
  const cats = await knex('service_categories').orderBy('id').select('id', 'name', 'is_active');
  if (cats.length) {
    const pick = (re) => (cats.find((c) => c.is_active && re.test(c.name)) || cats.find((c) => c.is_active) || cats[0]).id;
    for (const [title, re] of NEW_SERVICES) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await knex('services').whereRaw('lower(title) = lower(?)', [title]).first('id');
      // eslint-disable-next-line no-await-in-loop
      if (!exists) await knex('services').insert({ title, service_category_id: pick(re), service_type: 'internal', is_active: true });
    }
  }

  const services = (await knex('services').select('id')).map((s) => s.id);
  const retailer = await knex('user_types').whereRaw("lower(name) = 'retailer'").first('id');
  if (retailer && services.length) {
    await knex('user_type_services').insert(services.map((id) => ({ user_type_id: retailer.id, service_id: id })));

    // Retailers with a non-empty Service Access list keep exactly those services.
    const users = await knex('users').where({ user_type_id: retailer.id }).whereNotNull('service_access').select('id', 'service_access');
    const rows = [];
    for (const u of users) {
      const list = typeof u.service_access === 'string' ? JSON.parse(u.service_access) : u.service_access;
      if (!Array.isArray(list) || !list.length) continue;
      const allowed = new Set(list.map(Number));
      for (const id of services) if (!allowed.has(id)) rows.push({ user_id: u.id, service_id: id, allowed: false });
    }
    if (rows.length) await knex('user_service_overrides').insert(rows);
  }

  const modules = await knex('menu_items').where({ title: 'Modules' }).whereNull('parent_id').first('id');
  if (!(await knex('menu_items').where({ route: '/modules/service-permissions' }).first('id'))) {
    await knex('menu_items').insert({
      parent_id: modules ? modules.id : null, title: 'Service Permissions', icon: 'lock', route: '/modules/service-permissions', sort_order: 4, scope: 'admin', is_active: true,
    });
  }
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ route: '/modules/service-permissions' }).del();
  await knex.schema.dropTableIfExists('user_service_overrides');
  await knex.schema.dropTableIfExists('user_type_services');
  for (const [title] of NEW_SERVICES) {
    // eslint-disable-next-line no-await-in-loop
    const s = await knex('services').whereRaw('lower(title) = lower(?)', [title]).first('id');
    // eslint-disable-next-line no-await-in-loop
    if (s && !(await knex('commission_slots').where({ service_id: s.id }).first('id'))) await knex('services').where({ id: s.id }).del();
  }
};
