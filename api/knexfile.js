'use strict';

/**
 * Knex configuration for migrations and seeds.
 * Reuses the same env-driven connection the app uses at runtime, so
 * `npm run migrate` / `npm run seed` act on whatever DB your env points at.
 */
const env = require('./src/config/env');

const base = {
  client: 'pg',
  connection: env.buildPgConnection(),
  pool: { min: 0, max: 10 },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './seeds',
  },
};

module.exports = {
  development: base,
  production: base,
};
