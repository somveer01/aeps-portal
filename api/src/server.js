'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const { startJobs } = require('./services/reconciliation.service');
const serviceGuard = require('./services/serviceGuard.service');

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
    // A service name the app sends with no Service Master row is refused until the admin adds it: say so at startup (also in /api/health).
    serviceGuard.missingNames().then((missing) => {
      // eslint-disable-next-line no-console
      if (missing.length) console.warn(`WARNING: not in Service Master (these services are refused): ${missing.join(', ')}`);
    }).catch(() => {});
  });
}

start();
