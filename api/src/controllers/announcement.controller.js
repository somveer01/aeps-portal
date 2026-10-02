'use strict';

const { parseGrid } = require('../utils/gridQuery');
const repo = require('../repositories/announcement.repo');
const userTypeRepo = require('../repositories/userType.repo');

const clean = (v) => String(v || '').trim();

async function list(req, res, next) {
  try {
    const q = clean(req.query.q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q, page, pageSize, grid: parseGrid(req.query, repo.GRID) });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

// GET /api/announcements/active  -> active announcements (banner on user dashboards)
async function active(req, res, next) {
  try {
    const userTypeId = req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null;
    return res.json({ rows: await repo.activeForUserType(userTypeId) });
  } catch (err) { return next(err); }
}

async function create(req, res, next) {
  try {
    const userTypeId = parseInt(req.body.userTypeId, 10);
    if (!userTypeId || !(await userTypeRepo.findById(userTypeId))) return res.status(400).json({ error: 'Please select a valid user type', code: 'INVALID_USER_TYPE' });
    const message = String(req.body.message || '').trim();
    if (message.length < 2) return res.status(400).json({ error: 'Announcement message is required', code: 'INVALID_MESSAGE' });
    if (message.length > 5000) return res.status(400).json({ error: 'Message is too long', code: 'TOO_LONG' });
    const id = await repo.create({ userTypeId, title: clean(req.body.title), message, isActive: req.body.isActive !== false });
    return res.status(201).json({ row: await repo.findById(id) });
  } catch (err) { return next(err); }
}

async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const patch = {};
    if (req.body.userTypeId !== undefined) {
      const utId = parseInt(req.body.userTypeId, 10);
      if (!utId || !(await userTypeRepo.findById(utId))) return res.status(400).json({ error: 'Invalid user type', code: 'INVALID_USER_TYPE' });
      patch.userTypeId = utId;
    }
    if (req.body.message !== undefined) {
      const message = String(req.body.message || '').trim();
      if (message.length < 2) return res.status(400).json({ error: 'Message is required', code: 'INVALID_MESSAGE' });
      patch.message = message;
    }
    if (req.body.title !== undefined) patch.title = clean(req.body.title);
    if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
    await repo.update(id, patch);
    return res.json({ row: await repo.findById(id) });
  } catch (err) { return next(err); }
}

async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    await repo.remove(id);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

module.exports = { list, active, create, update, remove };
