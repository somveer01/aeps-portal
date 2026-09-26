'use strict';

const data = require('./data/india-cities');

/** Seeds states + cities from the India dataset. Idempotent. */
exports.seed = async function seed(knex) {
  const count = await knex('states').count('id as c').first();
  if (Number(count.c) > 0) {
    // eslint-disable-next-line no-console
    console.log('States/cities already seeded — skipping.');
    return;
  }

  const stateNames = Object.keys(data).sort();
  const stateRows = await knex('states')
    .insert(stateNames.map((name) => ({ name })))
    .returning(['id', 'name']);

  const idByName = new Map(stateRows.map((r) => [r.name, r.id]));

  const cities = [];
  for (const [stateName, cityList] of Object.entries(data)) {
    const stateId = idByName.get(stateName);
    // de-dupe city names per state (unique constraint)
    const seen = new Set();
    for (const c of cityList) {
      const key = c.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cities.push({ state_id: stateId, name: c });
    }
  }
  // batch insert
  await knex.batchInsert('cities', cities, 200);

  // eslint-disable-next-line no-console
  console.log(`Seeded ${stateRows.length} states and ${cities.length} cities.`);
};
