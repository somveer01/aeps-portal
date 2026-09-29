'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const { startJobs } = require('./services/reconciliation.service');

async function start() {
  try {
    // Fail fast with a clear message if the DB is unreachable.
    await db.raw('select 1');
    // eslint-disable-next-line no-console
    console.log('Database connection OK.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Could not connect to the database. Check your .env / DB setup.');
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  }

  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`AEPS Portal running at http://localhost:${env.port} (${env.nodeEnv})`);
    startJobs();
  });
}

start();
