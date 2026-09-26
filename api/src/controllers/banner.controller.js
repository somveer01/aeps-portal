'use strict';

const repo = require('../repositories/banner.repo');

const clean = (v) => String(v || '').trim();
const UPLOAD_PATH = /^\/uploads\/[\w.-]+$/;
const cleanImage = (v) => { const s = clean(v); return s && UPLOAD_PATH.test(s) ? s : null; };
const TYPES = ['login', 'app'];
const cleanType = (v) => { const s = clean(v).toLowerCase(); return TYPES.includes(s) ? s : 'login'; };

async function list(req, res, next) {
  try {
    const q = clean(req.query.q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q, page, pageSize });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

async function create(req, res, next) {
  try {
    const title = clean(req.body.title);
    if (title.length < 2 || title.length > 150) return res.status(400).json({ error: 'Title must be 2–150 characters', code: 'INVALID_TITLE' });
    const id = await repo.create({
      title, image: cleanImage(req.body.image), link: clean(req.body.link),
      type: cleanType(req.body.type),
      sortOrder: parseInt(req.body.sortOrder, 10) || 0, isActive: req.body.isActive !== false,
    });
    return res.status(201).json({ row: await repo.findById(id) });
  } catch (err) { return next(err); }
}

async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const patch = {};
    if (req.body.title !== undefined) {
      const title = clean(req.body.title);
      if (title.length < 2 || title.length > 150) return res.status(400).json({ error: 'Invalid title', code: 'INVALID_TITLE' });
      patch.title = title;
    }
    if (req.body.image !== undefined) patch.image = cleanImage(req.body.image);
    if (req.body.link !== undefined) patch.link = clean(req.body.link);
    if (req.body.type !== undefined) patch.type = cleanType(req.body.type);
    if (req.body.sortOrder !== undefined) patch.sortOrder = parseInt(req.body.sortOrder, 10) || 0;
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

module.exports = { list, create, update, remove };
