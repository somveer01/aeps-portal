'use strict';

/** Seeds user types + services (from the reference recording). Idempotent. */
exports.seed = async function seed(knex) {
  // ── User types ────────────────────────────────────────────────
  const utCount = await knex('user_types').count('id as c').first();
  if (Number(utCount.c) === 0) {
    await knex('user_types').insert(
      ['Whitelabel', 'Super Distributor', 'Distributor', 'Retailer', 'Employee'].map((name) => ({ name })),
    );
    // eslint-disable-next-line no-console
    console.log('Seeded user types.');
  } else {
    // eslint-disable-next-line no-console
    console.log('User types already seeded — skipping.');
  }

  // ── Services ──────────────────────────────────────────────────
  const svcCount = await knex('services').count('id as c').first();
  if (Number(svcCount.c) > 0) {
    // eslint-disable-next-line no-console
    console.log('Services already seeded — skipping.');
    await retailerDefaults(knex);
    return;
  }

  const cats = await knex('service_categories').select('id', 'name');
  const catId = (name) => (cats.find((c) => c.name.toLowerCase() === name.toLowerCase()) || cats[0]).id;
  const b2b = catId('B2B Services');
  const online = catId('Online Services');

  const services = [
    ['Mobile Recharge', b2b, 'internal'],
    ['DTH Recharge', b2b, 'internal'],
    ['Bill Payment', b2b, 'internal'],
    ['AEPS', b2b, 'internal'],
    ['Money Transfer', b2b, 'internal'],
    ['Move To Bank', b2b, 'internal'],
    ['Fund Request', b2b, 'internal'],
    ['Aadhar Pay', b2b, 'internal'],
    ['Merchant eKYC', online, 'external'],
    ['Load Money', b2b, 'internal'],
    ['Micro ATM', b2b, 'internal'],
    ['LIC Payment', b2b, 'internal'],
    ['Fastag Recharge', b2b, 'internal'],
    ['PAN Card', online, 'external'],
    ['Gas Booking', b2b, 'internal'],
    ['Flight Booking', online, 'internal'],
    ['Hotel Booking', online, 'internal'],
    ['Bus Booking', online, 'internal'],
    ['UPI Collection', b2b, 'internal'],
    ['Fino CMS', b2b, 'internal'],
  ].map(([title, service_category_id, service_type]) => ({ title, service_category_id, service_type }));

  await knex.batchInsert('services', services, 50);
  // eslint-disable-next-line no-console
  console.log(`Seeded ${services.length} services.`);
  await retailerDefaults(knex);
};

// Service Permissions default: the Retailer type may use every service (only when nothing is set yet).
async function retailerDefaults(knex) {
  const retailer = await knex('user_types').whereRaw("lower(name) = 'retailer'").first('id');
  if (!retailer || await knex('user_type_services').first('service_id')) return;
  const rows = (await knex('services').select('id')).map((r) => ({ user_type_id: retailer.id, service_id: r.id }));
  if (rows.length) await knex('user_type_services').insert(rows);
  // eslint-disable-next-line no-console
  console.log(`Allowed ${rows.length} services for the Retailer type.`);
}
