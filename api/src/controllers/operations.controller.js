'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const { parseGrid, applyGridFilters, applyGridSortFirst, DATE_TEXT } = require('../utils/gridQuery');
const env = require('../config/env');
const audit = require('../repositories/audit.repo');
const { finalize } = require('../services/txnPipeline.service');
const recon = require('../services/reconciliation.service');

/**
 * Pending transactions and reconciliation: the provider callback (webhook) and the
 * admin screens that watch and settle what the jobs could not.
 */
const clean = (v) => String(v || '').trim();
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const pageOf = (q) => ({ page: Math.max(1, parseInt(q.page, 10) || 1), pageSize: Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 10)) });
const send = (e, res, next) => (e.status && e.code ? res.status(e.status).json({ error: e.message, code: e.code }) : next(e));

// POST /api/provider-callback  (no login; signed)  header x-signature = hex HMAC-SHA256(secret, raw body)
// body { clientRef, status: 'success'|'failed'|'pending', providerRef? }
async function providerCallback(req, res, next) {
  try {
    const secret = env.providerCallbackSecret;
    if (!secret) return res.status(503).json({ error: 'Callbacks are not configured', code: 'CALLBACK_NOT_CONFIGURED' });
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    const given = clean(req.get('x-signature')).toLowerCase();
    const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) return res.status(401).json({ error: 'Bad signature', code: 'BAD_SIGNATURE' });

    const { clientRef, status, providerRef } = req.body || {};
    const t = await db('service_transactions').where({ client_ref: clean(clientRef) }).first('id', 'status');
    if (!t) return res.status(404).json({ error: 'Unknown clientRef', code: 'NOT_FOUND' });
    if (status === 'pending') return res.json({ ok: true, changed: false, status: t.status });
    if (!['success', 'failed'].includes(status)) return res.status(400).json({ error: 'status must be success, failed or pending', code: 'INVALID_STATUS' });

    const f = await finalize(t.id, status, { source: 'callback', providerRef: clean(providerRef) || null });
    if (!f.changed && f.status !== status) {
      // Already settled the other way: leave the money alone and flag it for review.
      await audit.log({ userId: null, username: 'provider', event: 'provider_callback_mismatch', detail: { serviceTransactionId: t.id, ours: f.status, provider: status }, ...meta(req) });
    }
    return res.json({ ok: true, changed: f.changed, status: f.status });
  } catch (e) { return send(e, res, next); }
}

// GET /api/pending-transactions?q=
// Sortable / filterable columns of the Pending Transactions grid.
const PENDING_GRID = {
  user: { sort: 'u.full_name', filter: "concat_ws(' ', u.full_name, u.user_code)" },
  service: { sort: 'x.service', filter: "concat_ws(' ', x.service, x.operator)" }, target: 'x.target', amount: 'x.amount',
  refs: { sort: 'x.client_ref', filter: "concat_ws(' ', x.client_ref, x.reference_id)" },
  waiting: { sort: 'x.created_at', filter: DATE_TEXT('x.created_at') }, checks: 'x.check_count',
};

async function listPending(req, res, next) {
  try {
    const f = pageOf(req.query); const q = clean(req.query.q); const grid = parseGrid(req.query, PENDING_GRID);
    const base = () => {
      const qb = db('service_transactions as x').join('users as u', 'u.id', 'x.user_id').where('x.status', 'pending');
      if (q) qb.andWhere((w) => w.whereILike('u.user_code', `%${q}%`).orWhereILike('u.full_name', `%${q}%`).orWhereILike('x.client_ref', `%${q}%`).orWhereILike('x.reference_id', `%${q}%`));
      applyGridFilters(qb, grid);
      return qb;
    };
    const countRow = await base().count('x.id as c').first();
    const rows = await base().select('x.id', 'x.service', 'x.operator', 'x.target', 'x.amount', 'x.debit_amount', 'x.client_ref', 'x.reference_id',
      'x.created_at', 'x.check_count', 'x.last_checked_at', 'u.user_code', 'u.full_name as user_name',
      db.raw('extract(epoch from (now() - x.created_at))::int as age_seconds'))
      .modify((qb) => applyGridSortFirst(qb, grid)).orderBy('x.created_at', 'asc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
    return res.json({ rows, total: Number(countRow.c), ...f });
  } catch (e) { return next(e); }
}

// POST /api/pending-transactions/check — run the status check now for every pending one.
async function checkAll(req, res, next) {
  try {
    const r = await recon.runStatusChecks({ minAgeSec: 0, limit: 200 });
    if (r.skipped) return res.status(409).json({ error: 'A status check is already running. Try again in a minute.', code: 'JOB_RUNNING' });
    return res.json({ checked: r.checked, settled: r.settled });
  } catch (e) { return send(e, res, next); }
}

// POST /api/pending-transactions/:id/check
async function checkOneTxn(req, res, next) {
  try {
    const t = await db('service_transactions').where({ id: parseInt(req.params.id, 10) }).first();
    if (!t) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    if (t.status !== 'pending') return res.json({ id: t.id, status: t.status, changed: false });
    return res.json(await recon.checkOne(t));
  } catch (e) { return send(e, res, next); }
}

// PUT /api/pending-transactions/:id { status: 'success'|'failed', note } — admin settles by hand
// (e.g. after the provider confirmed on a ticket). Failed refunds the user; success pays commission.
async function settleByAdmin(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const status = req.body && req.body.status;
    const note = clean(req.body && req.body.note);
    if (note.length < 3) return res.status(400).json({ error: 'Write what the provider confirmed (ticket / reference)', code: 'NOTE_REQUIRED' });
    const f = await finalize(id, status, { source: 'admin', note: `${note} — by ${req.user.username}` });
    if (!f.changed) return res.status(409).json({ error: `Already settled as ${f.status}`, code: 'ALREADY_FINAL' });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'pending_settled_by_admin', detail: { id, status }, ...meta(req) });
    return res.json({ id, status: f.status });
  } catch (e) { return send(e, res, next); }
}

// GET /api/reconciliation/runs
// Sortable / filterable columns of the reconciliation grids.
const RUN_GRID = {
  date: { sort: 'r.run_date', filter: "to_char(r.run_date, 'YYYY-MM-DD DD Mon YYYY')" }, total: 'r.total', matched: 'r.matched', mismatched: 'r.mismatched',
  open_items: { sort: "(select count(*) from reconciliation_items oi where oi.run_id = r.id and oi.state = 'open')", filter: "case when r.status = 'failed' then 'run failed' when (select count(*) from reconciliation_items oi where oi.run_id = r.id and oi.state = 'open') > 0 then (select count(*) from reconciliation_items oi where oi.run_id = r.id and oi.state = 'open') || ' open' else 'all clear' end" },
  auto_fixed: 'r.auto_fixed', ran: { sort: 'r.started_at', filter: "concat_ws(' ', to_char(r.started_at, 'DD Mon YYYY HH24:MI YYYY-MM-DD'), coalesce(u.username, 'scheduler'))" },
};
const ITEM_GRID = {
  type: 'i.type', client_ref: { sort: 'i.client_ref', filter: "concat_ws(' ', i.client_ref, x.service)" },
  user: { sort: 'u.full_name', filter: "concat_ws(' ', u.full_name, u.user_code)" },
  ours: { sort: 'i.our_status', filter: "concat_ws(' ', coalesce(i.our_status, 'not recorded'), i.our_amount)" },
  provider: { sort: 'i.provider_status', filter: "concat_ws(' ', coalesce(i.provider_status, 'not in report'), i.provider_amount)" },
  state: 'i.state', note: { sort: 'i.note', filter: "concat_ws(' ', i.note, rv.username)" },
};

async function listRuns(req, res, next) {
  try {
    const f = pageOf(req.query); const grid = parseGrid(req.query, RUN_GRID);
    const base = () => db('reconciliation_runs as r').leftJoin('users as u', 'u.id', 'r.run_by').where((qb) => applyGridFilters(qb, grid));
    const countRow = await base().count('r.id as c').first();
    const rows = await base()
      .select('r.*', db.raw("to_char(r.run_date, 'YYYY-MM-DD') as run_date"), 'u.username as run_by_name',
        db.raw("(select count(*)::int from reconciliation_items i where i.run_id = r.id and i.state = 'open') as open_items"))
      .modify((qb) => applyGridSortFirst(qb, grid)).orderBy('r.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
    return res.json({ rows, total: Number(countRow.c), ...f });
  } catch (e) { return next(e); }
}

// POST /api/reconciliation/runs { date }
async function runNow(req, res, next) {
  try {
    const r = await recon.runReconciliation(clean(req.body && req.body.date), req.user.id);
    if (r.skipped) return res.status(409).json({ error: 'A reconciliation is already running. Try again in a minute.', code: 'JOB_RUNNING' });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'reconciliation_run', detail: r, ...meta(req) });
    return res.status(201).json(r);
  } catch (e) { return send(e, res, next); }
}

// GET /api/reconciliation/runs/:id/items?state=open
async function listItems(req, res, next) {
  try {
    const qb = db('reconciliation_items as i').leftJoin('service_transactions as x', 'x.id', 'i.service_transaction_id')
      .leftJoin('users as u', 'u.id', 'x.user_id').leftJoin('users as rv', 'rv.id', 'i.resolved_by')
      .where('i.run_id', parseInt(req.params.id, 10));
    if (['open', 'resolved', 'auto'].includes(req.query.state)) qb.where('i.state', req.query.state);
    const grid = parseGrid(req.query, ITEM_GRID);
    applyGridFilters(qb, grid);
    applyGridSortFirst(qb, grid);
    const rows = await qb.select('i.*', 'x.service', 'x.status as current_status', 'u.user_code', 'u.full_name as user_name', 'rv.username as resolved_by_name')
      .orderBy('i.id');
    return res.json({ rows });
  } catch (e) { return next(e); }
}

// PUT /api/reconciliation/items/:id { note } — mark an item resolved (dispute raised / adjustment done).
async function resolveItem(req, res, next) {
  try {
    const note = clean(req.body && req.body.note);
    if (note.length < 3) return res.status(400).json({ error: 'Write how this was resolved', code: 'NOTE_REQUIRED' });
    const n = await db('reconciliation_items').where({ id: parseInt(req.params.id, 10), state: 'open' })
      .update({ state: 'resolved', note, resolved_by: req.user.id, resolved_at: db.fn.now() });
    if (!n) return res.status(409).json({ error: 'This item is not open', code: 'NOT_OPEN' });
    return res.json({ ok: true });
  } catch (e) { return next(e); }
}

module.exports = { providerCallback, listPending, checkAll, checkOneTxn, settleByAdmin, listRuns, runNow, listItems, resolveItem };
