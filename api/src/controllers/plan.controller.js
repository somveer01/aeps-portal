'use strict';

const repo = require('../repositories/plan.repo');
const userTypeRepo = require('../repositories/userType.repo');

const clean = (v) => String(v || '').trim();

async function list(req, res, next) {
  try {
    const q = clean(req.query.q);
    const userTypeId = req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q, userTypeId, page, pageSize });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

async function create(req, res, next) {
  try {
    const name = clean(req.body.name);
    const userTypeId = parseInt(req.body.userTypeId, 10);
    if (!userTypeId || !(await userTypeRepo.findById(userTypeId))) return res.status(400).json({ error: 'Please select a valid user type', code: 'INVALID_USER_TYPE' });
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Plan name must be 2–120 characters', code: 'INVALID_NAME' });
    const id = await repo.create({ userTypeId, name, isActive: req.body.isActive !== false });
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
    if (req.body.name !== undefined) {
      const name = clean(req.body.name);
      if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Invalid plan name', code: 'INVALID_NAME' });
      patch.name = name;
    }
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
