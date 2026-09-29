'use strict';

/**
 * Services the retailer panel already offers but Service Master did not list, so the
 * admin can switch them off, grant access and set daily limits. Fresh databases get
 * them from seeds/04 (categories are seeded after migrations run).
 */
const SERVICES = [
  ['Gas Booking', /^b2b/i],
  ['Flight Booking', /online/i],
  ['Hotel Booking', /online/i],
  ['Bus Booking', /online/i],
];

exports.up = async function up(knex) {
  const cats = await knex('service_categories').orderBy('id').select('id', 'name', 'is_active');
  if (!cats.length) return;
  const pick = (re) => (cats.find((c) => c.is_active && re.test(c.name)) || cats.find((c) => c.is_active) || cats[0]).id;
  for (const [title, re] of SERVICES) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await knex('services').whereRaw('lower(title) = lower(?)', [title]).first('id');
    // eslint-disable-next-line no-await-in-loop
    if (!exists) await knex('services').insert({ title, service_category_id: pick(re), service_type: 'internal', is_active: true });
  }
};

exports.down = async function down(knex) {
  // Only remove rows nothing points at (a commission slot keeps its service).
  for (const [title] of SERVICES) {
    // eslint-disable-next-line no-await-in-loop
    const s = await knex('services').whereRaw('lower(title) = lower(?)', [title]).first('id');
    // eslint-disable-next-line no-await-in-loop
    if (s && !(await knex('commission_slots').where({ service_id: s.id }).first('id'))) await knex('services').where({ id: s.id }).del();
  }
};
