'use strict';

const { parseGrid } = require('../utils/gridQuery');
const stateRepo = require('../repositories/state.repo');
const cityRepo = require('../repositories/city.repo');

// GET /api/states  -> [{ id, name }]  (for dropdowns on any screen)
async function listStates(req, res, next) {
  try {
    return res.json({ states: await stateRepo.listActive() });
  } catch (err) {
    return next(err);
  }
}

// GET /api/cities?q=&stateId=&page=&pageSize=
async function listCities(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    const stateId = req.query.stateId ? parseInt(req.query.stateId, 10) : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await cityRepo.list({ q, stateId, page, pageSize, grid: parseGrid(req.query, cityRepo.GRID) });
    return res.json({ rows, total, page, pageSize });
  } catch (err) {
    return next(err);
  }
}

// POST /api/cities  { stateId, name }
async function createCity(req, res, next) {
  try {
    const stateId = parseInt(req.body.stateId, 10);
    const name = String(req.body.name || '').trim();
    if (!stateId || !(await stateRepo.findById(stateId))) {
      return res.status(400).json({ error: 'Please select a valid state', code: 'INVALID_STATE' });
    }
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: 'City name must be 2–120 characters', code: 'INVALID_NAME' });
    }
    if (await cityRepo.findByStateAndName(stateId, name)) {
      return res.status(409).json({ error: 'This city already exists in the selected state', code: 'DUPLICATE' });
    }
    const id = await cityRepo.create({ stateId, name, isActive: req.body.isActive !== false });
    return res.status(201).json({ row: await cityRepo.findById(id) });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/cities/:id  { stateId?, name?, isActive? }
async function updateCity(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await cityRepo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

    const patch = {};
    const stateId = req.body.stateId !== undefined ? parseInt(req.body.stateId, 10) : existing.state_id;
    if (req.body.stateId !== undefined) {
      if (!stateId || !(await stateRepo.findById(stateId))) return res.status(400).json({ error: 'Invalid state', code: 'INVALID_STATE' });
      patch.stateId = stateId;
    }
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Invalid city name', code: 'INVALID_NAME' });
      const dup = await cityRepo.findByStateAndName(stateId, name);
      if (dup && dup.id !== id) return res.status(409).json({ error: 'This city already exists in the selected state', code: 'DUPLICATE' });
      patch.name = name;
    }
    if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;

    await cityRepo.update(id, patch);
    return res.json({ row: await cityRepo.findById(id) });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/cities/:id
async function removeCity(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await cityRepo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    await cityRepo.remove(id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listStates, listCities, createCity, updateCity, removeCity };
