'use strict';

/** Starter service categories (matches the reference screen). Idempotent. */
exports.seed = async function seed(knex) {
  const count = await knex('service_categories').count('id as c').first();
  if (Number(count.c) > 0) {
    // eslint-disable-next-line no-console
    console.log('Service categories already seeded — skipping.');
    return;
  }
  await knex('service_categories').insert([
    { name: 'B2B Services', is_active: true },
    { name: 'Online Services', is_active: true },
  ]);
  // eslint-disable-next-line no-console
  console.log('Seeded service categories.');
};
