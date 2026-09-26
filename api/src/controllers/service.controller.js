'use strict';

const repo = require('../repositories/service.repo');
const catRepo = require('../repositories/serviceCategory.repo');

const clean = (v) => String(v || '').trim();
const TYPES = ['internal', 'external'];
// Accept only an uploaded path (/uploads/...) or empty; ignore anything else.
const cleanIcon = (v) => {
  const s = clean(v);
  if (!s) return null;
  return /^\/uploads\/[\w.-]+$/.test(s) && s.length <= 255 ? s : null;
};

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
    const serviceCategoryId = parseInt(req.body.serviceCategoryId, 10);
    const serviceType = TYPES.includes(req.body.serviceType) ? req.body.serviceType : 'internal';
    if (title.length < 2 || title.length > 120) return res.status(400).json({ error: 'Title must be 2–120 characters', code: 'INVALID_TITLE' });
    if (!serviceCategoryId || !(await catRepo.findById(serviceCategoryId))) return res.status(400).json({ error: 'Please select a valid service category', code: 'INVALID_CATEGORY' });
    if (await repo.findByTitle(title)) return res.status(409).json({ error: 'A service with this title already exists', code: 'DUPLICATE' });
    const id = await repo.create({ title, serviceCategoryId, serviceType, icon: cleanIcon(req.body.icon), isActive: req.body.isActive !== false });
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
      if (title.length < 2 || title.length > 120) return res.status(400).json({ error: 'Invalid title', code: 'INVALID_TITLE' });
      const dup = await repo.findByTitle(title);
      if (dup && dup.id !== id) return res.status(409).json({ error: 'A service with this title already exists', code: 'DUPLICATE' });
      patch.title = title;
    }
    if (req.body.serviceCategoryId !== undefined) {
      const cid = parseInt(req.body.serviceCategoryId, 10);
      if (!cid || !(await catRepo.findById(cid))) return res.status(400).json({ error: 'Invalid service category', code: 'INVALID_CATEGORY' });
      patch.serviceCategoryId = cid;
    }
    if (req.body.serviceType !== undefined) patch.serviceType = TYPES.includes(req.body.serviceType) ? req.body.serviceType : 'internal';
    if (req.body.icon !== undefined) patch.icon = cleanIcon(req.body.icon);
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
