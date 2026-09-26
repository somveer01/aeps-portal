'use strict';

const repo = require('../repositories/commissionSlot.repo');
const userTypeRepo = require('../repositories/userType.repo');
const serviceRepo = require('../repositories/service.repo');
const planRepo = require('../repositories/plan.repo');

const clean = (v) => String(v || '').trim();
const COMMISSION_TYPES = ['percentage', 'amount'];
const CHAIN_TYPES = ['self', 'chain'];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

async function list(req, res, next) {
  try {
    const q = clean(req.query.q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q, page, pageSize });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

// Read-only Commission Slab listing (filter by user type + service).
async function slab(req, res, next) {
  try {
    const userTypeId = req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null;
    const serviceId = req.query.serviceId ? parseInt(req.query.serviceId, 10) : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.slab({ userTypeId, serviceId, page, pageSize });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

async function validateRefs({ userTypeId, serviceId, planId }) {
  if (!userTypeId || !(await userTypeRepo.findById(userTypeId))) return 'Please select a valid user type';
  if (!serviceId || !(await serviceRepo.findById(serviceId))) return 'Please select a valid service';
  if (!planId || !(await planRepo.findById(planId))) return 'Please select a valid plan';
  return null;
}

function validateValues(body) {
  const commissionType = COMMISSION_TYPES.includes(body.commissionType) ? body.commissionType : null;
  if (!commissionType) return 'Commission type must be percentage or amount';
  const chainType = CHAIN_TYPES.includes(body.chainType) ? body.chainType : 'self';
  const minAmount = num(body.minAmount); const maxAmount = num(body.maxAmount); const value = num(body.value);
  if (Number.isNaN(minAmount) || Number.isNaN(maxAmount) || minAmount < 0 || maxAmount < minAmount) return 'Enter a valid amount range (min ≤ max)';
  if (Number.isNaN(value) || value < 0) return 'Enter a valid amount/percentage';
  if (commissionType === 'percentage' && value > 100) return 'Percentage cannot exceed 100';
  return { commissionType, chainType, minAmount, maxAmount, value };
}

async function create(req, res, next) {
  try {
    const userTypeId = parseInt(req.body.userTypeId, 10);
    const serviceId = parseInt(req.body.serviceId, 10);
    const planId = parseInt(req.body.planId, 10);
    const refErr = await validateRefs({ userTypeId, serviceId, planId });
    if (refErr) return res.status(400).json({ error: refErr, code: 'INVALID_REF' });
    const v = validateValues(req.body);
    if (typeof v === 'string') return res.status(400).json({ error: v, code: 'INVALID_VALUE' });
    const id = await repo.create({ userTypeId, serviceId, planId, operator: clean(req.body.operator), specificUser: clean(req.body.specificUser), isActive: req.body.isActive !== false, ...v });
    return res.status(201).json({ row: await repo.findById(id) });
  } catch (err) { return next(err); }
}

async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await repo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

    const patch = {};
    // Status-only toggle (no full re-validation).
    if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
    if (req.body.specificUser !== undefined) patch.specificUser = clean(req.body.specificUser);

    const touchesCore = ['userTypeId', 'serviceId', 'planId', 'commissionType', 'chainType', 'minAmount', 'maxAmount', 'value', 'operator']
      .some((k) => req.body[k] !== undefined);

    if (touchesCore) {
      const userTypeId = req.body.userTypeId !== undefined ? parseInt(req.body.userTypeId, 10) : existing.user_type_id;
      const serviceId = req.body.serviceId !== undefined ? parseInt(req.body.serviceId, 10) : existing.service_id;
      const planId = req.body.planId !== undefined ? parseInt(req.body.planId, 10) : existing.plan_id;
      const refErr = await validateRefs({ userTypeId, serviceId, planId });
      if (refErr) return res.status(400).json({ error: refErr, code: 'INVALID_REF' });
      const v = validateValues({
        commissionType: req.body.commissionType ?? existing.commission_type,
        chainType: req.body.chainType ?? existing.chain_type,
        minAmount: req.body.minAmount ?? existing.min_amount,
        maxAmount: req.body.maxAmount ?? existing.max_amount,
        value: req.body.value ?? existing.value,
      });
      if (typeof v === 'string') return res.status(400).json({ error: v, code: 'INVALID_VALUE' });
      Object.assign(patch, { userTypeId, serviceId, planId, operator: clean(req.body.operator ?? existing.operator), ...v });
    }

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

module.exports = { list, slab, create, update, remove };
