'use strict';

// Read-only: does every wallet match its ledger? `npm run check:ledger` (uses the database in api/.env, or PGHOST /
// PGPORT / PGUSER / PGPASSWORD / PGDATABASE from the environment - e.g. production through scripts/db-tunnel.ps1).
const db = require('../src/config/db');
const { findProblems } = require('../src/services/ledgerCheck.service');

(async () => {
  const problems = await findProblems({ db, limit: 200 });
  if (!problems.length) console.log('Ledger OK: every wallet matches its ledger.');
  else {
    console.log(`${problems.length} problem(s):`);
    problems.forEach((p) => console.log(`  [${p.kind}] ${p.userCode || p.userId}: ${p.detail}`));
  }
  await db.destroy();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(2); });
