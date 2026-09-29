'use strict';

const db = require('../config/db');
const env = require('../config/env');
const providers = require('./providers.service');
const { finalize } = require('./txnPipeline.service');

/**
 * Keeps pending money from getting stuck:
 *   - checkOne / runStatusChecks: ask the provider for the final status of pending
 *     transactions and settle them (success → commission, failed → refund).
 *   - runReconciliation: compare one day of our transactions with the provider's report;
 *     pending ones the provider has settled are finalized, every other difference is
 *     recorded as an open item for an admin.
 * A Postgres advisory lock makes sure only one server instance runs each job at a time.
 */
const LOCK_STATUS = 82510001;
const LOCK_RECON = 82510002;

async function withJobLock(key, fn) {
  return db.transaction(async (trx) => {
    const r = await trx.raw('select pg_try_advisory_xact_lock(?) as ok', [key]);
    if (!r.rows[0].ok) return { skipped: true };
    return fn();
  });
}

// Ask the provider about one pending transaction; settle it if the answer is final.
async function checkOne(txn) {
  await db('service_transactions').where({ id: txn.id }).update({ check_count: db.raw('check_count + 1'), last_checked_at: db.fn.now() });
  const res = await providers.status({ clientRef: txn.client_ref, providerRef: txn.reference_id, service: txn.service, amount: Number(txn.amount) });
  if (!res || !['success', 'failed'].includes(res.status)) return { id: txn.id, status: 'pending', changed: false };
  const f = await finalize(txn.id, res.status, { source: 'status_check', providerRef: res.providerRef || null });
  return { id: txn.id, status: f.status, changed: f.changed };
}

async function runStatusChecks({ limit = 50, minAgeSec = env.jobs.pendingMinAgeSec } = {}) {
  return withJobLock(LOCK_STATUS, async () => {
    const rows = await db('service_transactions').where({ status: 'pending' })
      .whereRaw('created_at < now() - (? * interval \'1 second\')', [minAgeSec])
      .orderByRaw('last_checked_at asc nulls first').limit(limit);
    const results = [];
    for (const t of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        results.push(await checkOne(t));
      } catch (e) {
        results.push({ id: t.id, error: e.message }); // e.g. provider down: stays pending, retried next run
      }
    }
    return { checked: results.length, settled: results.filter((r) => r.changed).length, results };
  });
}

// date: 'YYYY-MM-DD'. runBy: admin user id, or null for the scheduler.
async function runReconciliation(date, runBy = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw Object.assign(new Error('Choose a valid date'), { status: 400, code: 'INVALID_DATE' });
  return withJobLock(LOCK_RECON, async () => {
    const [runRow] = await db('reconciliation_runs').insert({ run_date: date, status: 'running', run_by: runBy }).returning('id');
    const runId = typeof runRow === 'object' ? runRow.id : runRow;
    try {
      const ours = await db('service_transactions').whereNotNull('client_ref').whereRaw('created_at::date = ?', [date])
        .select('id', 'client_ref', 'status', 'amount', 'service');
      const theirs = await providers.report({ date, ourRows: ours });
      const byRef = new Map(theirs.map((p) => [p.clientRef, p]));
      const items = []; let matched = 0; let autoFixed = 0;

      for (const o of ours) {
        const p = byRef.get(o.client_ref);
        byRef.delete(o.client_ref);
        const base = { run_id: runId, service_transaction_id: o.id, client_ref: o.client_ref, our_status: o.status, our_amount: o.amount };
        if (!p) {
          // A failed attempt the provider never recorded is fine; anything else is a gap.
          if (o.status === 'failed') { matched += 1; continue; }
          items.push({ ...base, type: 'MISSING_AT_PROVIDER' });
          continue;
        }
        const withP = { ...base, provider_status: p.status, provider_amount: p.amount };
        if (Number(p.amount) !== Number(o.amount)) { items.push({ ...withP, type: 'AMOUNT_MISMATCH' }); continue; }
        if (o.status === 'pending' && ['success', 'failed'].includes(p.status)) {
          // eslint-disable-next-line no-await-in-loop
          await finalize(o.id, p.status, { source: 'reconciliation' });
          autoFixed += 1;
          items.push({ ...withP, type: 'AUTO_FINALIZED', state: 'auto', note: `Settled as ${p.status} from the provider report` });
          continue;
        }
        if (p.status !== o.status) { items.push({ ...withP, type: 'STATUS_MISMATCH' }); continue; }
        matched += 1;
      }
      for (const p of byRef.values()) {
        items.push({ run_id: runId, client_ref: p.clientRef, type: 'MISSING_AT_OURS', provider_status: p.status, provider_amount: p.amount });
      }
      if (items.length) await db.batchInsert('reconciliation_items', items, 200);
      const mismatched = items.filter((i) => i.type !== 'AUTO_FINALIZED').length;
      await db('reconciliation_runs').where({ id: runId }).update({ status: 'done', total: ours.length, matched, mismatched, auto_fixed: autoFixed, finished_at: db.fn.now() });
      return { runId, total: ours.length, matched, mismatched, autoFixed };
    } catch (e) {
      await db('reconciliation_runs').where({ id: runId }).update({ status: 'failed', error: e.message, finished_at: db.fn.now() });
      throw e;
    }
  });
}

/** Background jobs for server.js: status checks on an interval, yesterday's reconciliation once a day. */
function startJobs(log = console) {
  if (!env.jobs.enabled) { log.log('Background jobs disabled (JOBS_ENABLED=false).'); return () => {}; }
  const everyMs = Math.max(30, env.jobs.statusCheckEverySec) * 1000;
  const statusTimer = setInterval(() => {
    runStatusChecks().then((r) => { if (r.settled) log.log(`Status check: settled ${r.settled} of ${r.checked} pending transaction(s).`); })
      .catch((e) => log.error('Status check failed:', e.message));
  }, everyMs);
  const reconTimer = setInterval(async () => {
    try {
      if (new Date().getHours() < env.jobs.reconHour) return;
      const y = new Date(Date.now() - 86400000);
      const date = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      if (await db('reconciliation_runs').where({ run_date: date }).whereIn('status', ['done', 'running']).first('id')) return;
      const r = await runReconciliation(date, null);
      if (!r.skipped) log.log(`Reconciliation ${date}: ${r.total} transactions, ${r.mismatched} to review, ${r.autoFixed} settled.`);
    } catch (e) { log.error('Reconciliation failed:', e.message); }
  }, 15 * 60 * 1000);
  log.log(`Background jobs on: status check every ${everyMs / 1000}s, daily reconciliation after ${env.jobs.reconHour}:00.`);
  return () => { clearInterval(statusTimer); clearInterval(reconTimer); };
}

module.exports = { checkOne, runStatusChecks, runReconciliation, startJobs };
