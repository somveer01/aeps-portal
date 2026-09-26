'use strict';

/**
 * Single shared Knex instance for the whole app.
 * Connection details come entirely from env (see config/env.js), so the
 * user's own DB/setup script owns provisioning — this only connects.
 */
const knex = require('knex');
const env = require('./env');

const db = knex({
  client: 'pg',
  connection: env.buildPgConnection(),
  pool: { min: 0, max: 10 },
});

module.exports = db;
