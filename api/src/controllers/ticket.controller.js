'use strict';

const repo = require('../repositories/ticket.repo');
const deptRepo = require('../repositories/ticketDept.repo');
const audit = require('../repositories/audit.repo');
const { str, id: idOf, oneOf, ValidationError } = require('../utils/validate');

const clean = (v) => String(v || '').trim();
const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

async function withReplies(row) {
  if (!row) return null;
  const replies = await repo.listReplies(row.id);
  return { ...row, replies };
}

// ── Admin ──────────────────────────────────────────────────────────
async function adminList(req, res, next) {
  try {
    const { rows, total } = await repo.list({
      status: STATUSES.includes(req.query.status) ? req.query.status : null,
      departmentId: req.query.departmentId ? parseInt(req.query.departmentId, 10) : null,
      priority: PRIORITIES.includes(req.query.priority) ? req.query.priority : null,
      userId: req.query.userId ? parseInt(req.query.userId, 10) : null,
      startDate: clean(req.query.startDate) || null,
      endDate: clean(req.query.endDate) || null,
      page: Math.max(1, parseInt(req.query.page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10)),
    });
    return res.json({ rows, total });
  } catch (err) { return next(err); }
}

async function adminGet(req, res, next) {
  try {
    const row = await repo.findById(parseInt(req.params.id, 10));
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return res.json({ row: await withReplies(row) });
  } catch (err) { return next(err); }
}

// PUT /api/tickets/:id  { status }
async function adminUpdateStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await repo.findById(id);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const status = oneOf(req.body.status, STATUSES, 'Status');
    await repo.updateStatus(id, status);
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'ticket_status_change', detail: { ticketId: id, status }, ...meta(req) });
    return res.json({ row: await withReplies(await repo.findById(id)) });
  } catch (err) { return next(err); }
}

async function adminReply(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await repo.findById(id);
    if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const message = str(req.body.message, 'Message', { min: 1, max: 4000 });
    await repo.addReply({ ticketId: id, senderId: req.user.id, senderRole: 'admin', message });
    // Auto-progress a fresh ticket once the admin engages.
    if (row.status === 'open') await repo.updateStatus(id, 'in_progress');
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'ticket_reply', detail: { ticketId: id, role: 'admin' }, ...meta(req) });
    return res.status(201).json({ row: await withReplies(await repo.findById(id)) });
  } catch (err) { return next(err); }
}

// ── Retailer (owner-scoped) ─────────────────────────────────────────
async function retailerList(req, res, next) {
  try {
    const { rows, total } = await repo.listForUser({
      userId: req.user.id,
      status: STATUSES.includes(req.query.status) ? req.query.status : null,
      page: Math.max(1, parseInt(req.query.page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10)),
    });
    return res.json({ rows, total });
  } catch (err) { return next(err); }
}

async function retailerGet(req, res, next) {
  try {
    const row = await repo.findById(parseInt(req.params.id, 10));
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return res.json({ row: await withReplies(row) });
  } catch (err) { return next(err); }
}

async function retailerCreate(req, res, next) {
  try {
    const departmentId = idOf(req.body.departmentId, 'department');
    if (!(await deptRepo.findById(departmentId))) throw new ValidationError('Please select a valid department', 'INVALID_REF');
    const subject = str(req.body.subject, 'Subject', { min: 3, max: 150 });
    const description = str(req.body.description, 'Description', { min: 5, max: 4000 });
    const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'medium';
    const ticketId = await repo.create({ userId: req.user.id, departmentId, subject, description, priority });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'ticket_created', detail: { ticketId }, ...meta(req) });
    return res.status(201).json({ row: await withReplies(await repo.findById(ticketId)) });
  } catch (err) { return next(err); }
}

async function retailerReply(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await repo.findById(id);
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    if (row.status === 'closed') return res.status(400).json({ error: 'This ticket is closed', code: 'TICKET_CLOSED' });
    const message = str(req.body.message, 'Message', { min: 1, max: 4000 });
    await repo.addReply({ ticketId: id, senderId: req.user.id, senderRole: 'retailer', message });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'ticket_reply', detail: { ticketId: id, role: 'retailer' }, ...meta(req) });
    return res.status(201).json({ row: await withReplies(await repo.findById(id)) });
  } catch (err) { return next(err); }
}

module.exports = { adminList, adminGet, adminUpdateStatus, adminReply, retailerList, retailerGet, retailerCreate, retailerReply };
