'use strict';

const { parseGrid } = require('../utils/gridQuery');
const db = require('../config/db');
const repo = require('../repositories/commissionSlot.repo');
const userTypeRepo = require('../repositories/userType.repo');
const serviceRepo = require('../repositories/service.repo');
const planRepo = require('../repositories/plan.repo');
const audit = require('../repositories/audit.repo');

const clean = (v) => String(v || '').trim();
const COMMISSION_TYPES = ['percentage', 'amount'];
const CHAIN_TYPES = ['self', 'chain'];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

// What a slot's "operator" can be for each service: an operator from the operators master, or the
// transfer mode for money services. Services not listed here have no choice (all operators only).
const OPERATOR_SOURCES = {
  'mobile recharge': { service: 'mobile' },
  'dth recharge': { service: 'dth' },
  'bill payment': { service: 'bbps' },
  'lic payment': { service: 'bbps', category: 'Insurance' },
  'fastag recharge': { service: 'fastag' },
  'gas booking': { service: 'gas' },
  'money transfer': { modes: ['IMPS', 'NEFT'] },
  'move to bank': { modes: ['IMPS', 'NEFT'] },
};

/** { kind: 'operator'|'mode'|null, options: [names] } for a service id. */
async function operatorOptions(serviceId) {
  const svc = serviceId ? await serviceRepo.findById(serviceId) : null;
  const src = svc && OPERATOR_SOURCES[String(svc.title).trim().toLowerCase()];
  if (!src) return { kind: null, options: [] };
  if (src.modes) return { kind: 'mode', options: src.modes };
  const q = db('operators').where({ is_active: true, service: src.service });
  if (src.category) q.where({ category: src.category });
  return { kind: 'operator', options: (await q.orderBy('name').select('name')).map((r) => r.name) };
}

/** Normalises the operator to the master's spelling; returns { error } when it is not a choice for the service. */
async function checkOperator(serviceId, operator) {
  const op = clean(operator);
  if (!op) return { operator: '' };
  const { options } = await operatorOptions(serviceId);
  const match = options.find((o) => o.toLowerCase() === op.toLowerCase());
  if (!match) return { error: options.length ? `Choose an operator from the list for this service (${options.join(', ')}) or leave it empty for all operators` : 'This service has no operator choice; leave it empty for all operators' };
  return { operator: match };
}

async function list(req, res, next) {
  try {
    const q = clean(req.query.q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q, page, pageSize, grid: parseGrid(req.query, repo.GRID) });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

// GET /api/commission-slots/operator-options?serviceId= -> choices for the slot form's Operator / Mode dropdown.
async function operatorChoices(req, res, next) {
  try { return res.json(await operatorOptions(parseInt(req.query.serviceId, 10) || null)); } catch (err) { return next(err); }
}

// Read-only Commission Slab listing (filter by user type + service).
async function slab(req, res, next) {
  try {
    const userTypeId = req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null;
    const serviceId = req.query.serviceId ? parseInt(req.query.serviceId, 10) : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.slab({ userTypeId, serviceId, page, pageSize, grid: parseGrid(req.query, repo.GRID) });
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

// Audit trail of slot changes: who changed which slot, and its values before / after.
const snapshot = (r) => r && ({
  id: r.id, userType: r.user_type_name, service: r.service_name, plan: r.plan_name, operator: r.operator || null,
  commissionType: r.commission_type, value: Number(r.value), chainType: r.chain_type, txnType: r.txn_type,
  minAmount: Number(r.min_amount), maxAmount: Number(r.max_amount), specificUser: r.specific_user || null, isActive: r.is_active,
});
const logSlot = (req, event, detail) => audit.log({ userId: req.user.id, username: req.user.username, event, detail, ...meta(req) });

async function create(req, res, next) {
  try {
    const userTypeId = parseInt(req.body.userTypeId, 10);
    const serviceId = parseInt(req.body.serviceId, 10);
    const planId = parseInt(req.body.planId, 10);
    const refErr = await validateRefs({ userTypeId, serviceId, planId });
    if (refErr) return res.status(400).json({ error: refErr, code: 'INVALID_REF' });
    const v = validateValues(req.body);
    if (typeof v === 'string') return res.status(400).json({ error: v, code: 'INVALID_VALUE' });
    const op = await checkOperator(serviceId, req.body.operator);
    if (op.error) return res.status(400).json({ error: op.error, code: 'INVALID_OPERATOR' });
    const id = await repo.create({ userTypeId, serviceId, planId, operator: op.operator, specificUser: clean(req.body.specificUser), isActive: req.body.isActive !== false, ...v });
    const row = await repo.findById(id);
    await logSlot(req, 'commission_slot_created', { after: snapshot(row) });
    return res.status(201).json({ row });
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
      let operator = clean(req.body.operator ?? existing.operator);
      // Check the operator only when it (or the service) changes, so an old value never blocks other edits.
      if (operator.toLowerCase() !== clean(existing.operator).toLowerCase() || serviceId !== existing.service_id) {
        const op = await checkOperator(serviceId, operator);
        if (op.error) return res.status(400).json({ error: op.error, code: 'INVALID_OPERATOR' });
        operator = op.operator;
      }
      Object.assign(patch, { userTypeId, serviceId, planId, operator, ...v });
    }

    await repo.update(id, patch);
    const row = await repo.findById(id);
    await logSlot(req, 'commission_slot_updated', { before: snapshot(existing), after: snapshot(row) });
    return res.json({ row });
  } catch (err) { return next(err); }
}

async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await repo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    await repo.remove(id);
    await logSlot(req, 'commission_slot_deleted', { before: snapshot(existing) });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

module.exports = { list, slab, operatorChoices, create, update, remove };
