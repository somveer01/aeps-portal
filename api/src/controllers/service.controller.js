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

// What the API provider pays the company per transaction: a % of the amount or a flat ₹.
const PC_TYPES = ['percentage', 'amount'];
function providerCommission(body) {
  const out = {};
  if (body.providerCommissionType !== undefined) {
    if (!PC_TYPES.includes(body.providerCommissionType)) return { error: 'Provider commission type must be percentage or amount' };
    out.providerCommissionType = body.providerCommissionType;
  }
  if (body.providerCommissionValue !== undefined) {
    const v = Number(body.providerCommissionValue === '' ? 0 : body.providerCommissionValue);
    if (!Number.isFinite(v) || v < 0 || v > 1000000) return { error: 'Provider commission must be a number of 0 or more' };
    if (body.providerCommissionType === 'percentage' && v > 100) return { error: 'Provider commission % cannot be above 100' };
    out.providerCommissionValue = Math.round(v * 100) / 100;
  }
  // Per-user daily amount limit for this service; 0 = no limit.
  if (body.dailyLimit !== undefined) {
    const d = Number(body.dailyLimit === '' ? 0 : body.dailyLimit);
    if (!Number.isFinite(d) || d < 0 || d > 100000000) return { error: 'Daily limit must be 0 (no limit) or more' };
    out.dailyLimit = Math.round(d * 100) / 100;
  }
  return { out };
}

async function list(req, res, next) {
  try {
    const q = clean(req.query.q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    // ?active=1 -> only switched-on services (dropdowns); Service Master itself lists all.
    const { rows, total } = await repo.list({ q, page, pageSize, activeOnly: req.query.active === '1' });
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
    const pc = providerCommission(req.body);
    if (pc.error) return res.status(400).json({ error: pc.error, code: 'INVALID_PROVIDER_COMMISSION' });
    const id = await repo.create({ title, serviceCategoryId, serviceType, icon: cleanIcon(req.body.icon), isActive: req.body.isActive !== false, ...pc.out });
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
    const pc = providerCommission(req.body);
    if (pc.error) return res.status(400).json({ error: pc.error, code: 'INVALID_PROVIDER_COMMISSION' });
    Object.assign(patch, pc.out);
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
