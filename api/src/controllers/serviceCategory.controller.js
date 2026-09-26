'use strict';

const repo = require('../repositories/serviceCategory.repo');

function cleanName(v) {
  return String(v || '').trim();
}

// GET /api/service-categories?q=&page=&pageSize=
async function list(req, res, next) {
  try {
    const q = cleanName(req.query.q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q, page, pageSize });
    return res.json({ rows, total, page, pageSize });
  } catch (err) {
    return next(err);
  }
}

// POST /api/service-categories  { name, isActive? }
async function create(req, res, next) {
  try {
    const name = cleanName(req.body.name);
    if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters', code: 'INVALID_NAME' });
    if (name.length > 120) return res.status(400).json({ error: 'Name is too long', code: 'INVALID_NAME' });
    if (await repo.findByName(name)) return res.status(409).json({ error: 'A category with this name already exists', code: 'DUPLICATE' });

    const row = await repo.create({ name, isActive: req.body.isActive !== false });
    return res.status(201).json({ row });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/service-categories/:id  { name?, isActive? }
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await repo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

    const patch = {};
    if (req.body.name !== undefined) {
      const name = cleanName(req.body.name);
      if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Invalid name', code: 'INVALID_NAME' });
      const dup = await repo.findByName(name);
      if (dup && dup.id !== id) return res.status(409).json({ error: 'A category with this name already exists', code: 'DUPLICATE' });
      patch.name = name;
    }
    if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;

    const row = await repo.update(id, patch);
    return res.json({ row });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/service-categories/:id
async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await repo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    await repo.remove(id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, create, update, remove };
