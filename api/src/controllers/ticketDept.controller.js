'use strict';

const { parseGrid } = require('../utils/gridQuery');
const repo = require('../repositories/ticketDept.repo');

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

async function create(req, res, next) {
  try {
    const name = clean(req.body.name);
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Name must be 2–120 characters', code: 'INVALID_NAME' });
    if (await repo.findByName(name)) return res.status(409).json({ error: 'This department already exists', code: 'DUPLICATE' });
    return res.status(201).json({ row: await repo.create({ name, isActive: req.body.isActive !== false }) });
  } catch (err) { return next(err); }
}

async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const patch = {};
    if (req.body.name !== undefined) {
      const name = clean(req.body.name);
      if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Invalid name', code: 'INVALID_NAME' });
      const dup = await repo.findByName(name);
      if (dup && dup.id !== id) return res.status(409).json({ error: 'This department already exists', code: 'DUPLICATE' });
      patch.name = name;
    }
    if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
    return res.json({ row: await repo.update(id, patch) });
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

module.exports = { list, create, update, remove };
