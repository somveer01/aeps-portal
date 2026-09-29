'use strict';

const repo = require('../repositories/userType.repo');

const clean = (v) => String(v || '').trim();

// Parent type = the user type directly above this one (e.g. Retailer → Distributor).
// It must exist, not be the type itself, and not create a loop.
async function checkParentType(parentTypeId, selfId) {
  if (!parentTypeId) return null;
  if (selfId && parentTypeId === selfId) return 'A user type cannot be its own parent';
  let cur = await repo.findById(parentTypeId);
  if (!cur) return 'Parent type not found';
  for (let i = 0; selfId && cur && cur.parent_type_id && i < 20; i += 1) {
    if (cur.parent_type_id === selfId) return 'This parent type is already below this type';
    // eslint-disable-next-line no-await-in-loop
    cur = await repo.findById(cur.parent_type_id);
  }
  return null;
}
const parentIdOf = (v) => (v === '' || v === null || v === undefined ? null : parseInt(v, 10) || null);

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
    const name = clean(req.body.name);
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be 2–80 characters', code: 'INVALID_NAME' });
    if (await repo.findByName(name)) return res.status(409).json({ error: 'This user type already exists', code: 'DUPLICATE' });
    const parentTypeId = parentIdOf(req.body.parentTypeId);
    const perr = await checkParentType(parentTypeId, null);
    if (perr) return res.status(400).json({ error: perr, code: 'INVALID_PARENT_TYPE' });
    return res.status(201).json({ row: await repo.create({ name, isActive: req.body.isActive !== false, parentTypeId }) });
  } catch (err) { return next(err); }
}

async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const patch = {};
    if (req.body.name !== undefined) {
      const name = clean(req.body.name);
      if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Invalid name', code: 'INVALID_NAME' });
      const dup = await repo.findByName(name);
      if (dup && dup.id !== id) return res.status(409).json({ error: 'This user type already exists', code: 'DUPLICATE' });
      patch.name = name;
    }
    if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
    if (req.body.parentTypeId !== undefined) {
      const parentTypeId = parentIdOf(req.body.parentTypeId);
      const perr = await checkParentType(parentTypeId, id);
      if (perr) return res.status(400).json({ error: perr, code: 'INVALID_PARENT_TYPE' });
      patch.parentTypeId = parentTypeId;
    }
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
