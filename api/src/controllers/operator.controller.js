'use strict';

const { parseGrid } = require('../utils/gridQuery');
const repo = require('../repositories/operator.repo');
const audit = require('../repositories/audit.repo');
const { OPERATOR_GROUPS } = require('../services/operatorOptions');

// Operator Master (admin): the operators the retailer screens (Mobile Recharge, DTH, Bill Payment, FASTag, Gas), Commission
// Slots and API Management's SP Keys offer. Routes: /api/operator-master (the retailer reads /api/operators).
const clean = (v) => String(v || '').trim();
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const GROUP_KEYS = OPERATOR_GROUPS.map((g) => g.key);
const bad = (res, error, code = 'INVALID_INPUT', status = 400) => res.status(status).json({ error, code });
const snapshot = (r) => r && ({ id: r.id, service: r.service, category: r.category || null, name: r.name, code: r.code || null, circleRequired: r.circle_required, isActive: r.is_active });
const log = (req, event, detail) => audit.log({ userId: req.user.id, username: req.user.username, event, detail, ...meta(req) });

function validate(body, current = null) {
  const existing = current || { name: '', service: '', category: '', code: '', circle_required: false, is_active: true };
  const out = {};
  const name = body.name !== undefined ? clean(body.name) : existing.name;
  if (name.length < 2 || name.length > 120) return { error: 'Operator name must be 2 to 120 characters', code: 'INVALID_NAME' };
  out.name = name;
  const service = body.service !== undefined ? clean(body.service) : existing.service;
  if (!GROUP_KEYS.includes(service)) return { error: `Choose what the operator is for (${OPERATOR_GROUPS.map((g) => g.label).join(', ')})`, code: 'INVALID_SERVICE' };
  out.service = service;
  const category = body.category !== undefined ? clean(body.category) : (existing.category || '');
  if (category.length > 60) return { error: 'Category is too long (60 characters at most)', code: 'INVALID_CATEGORY' };
  out.category = category || null;
  const code = body.code !== undefined ? clean(body.code) : (existing.code || '');
  if (code.length > 60) return { error: 'Code is too long (60 characters at most)', code: 'INVALID_CODE' };
  out.code = code || null;
  out.circleRequired = body.circleRequired !== undefined ? !!body.circleRequired : existing.circle_required;
  out.isActive = body.isActive !== undefined ? !!body.isActive : existing.is_active;
  return { value: out };
}

// GET /api/operator-master?q=&service=&page=&pageSize=
async function list(req, res, next) {
  try {
    const service = GROUP_KEYS.includes(clean(req.query.service)) ? clean(req.query.service) : '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q: clean(req.query.q), service, page, pageSize, grid: parseGrid(req.query, repo.GRID) });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

// GET /api/operator-master/groups -> what an operator can be for
function groups(req, res) { return res.json({ rows: OPERATOR_GROUPS }); }

// POST /api/operator-master { name, service, category?, code?, circleRequired?, isActive? }
async function create(req, res, next) {
  try {
    const v = validate(req.body || {});
    if (v.error) return bad(res, v.error, v.code);
    if (await repo.findByName(v.value.service, v.value.name)) return bad(res, 'This operator already exists for this service', 'DUPLICATE', 409);
    const row = await repo.create(v.value);
    await log(req, 'operator_created', { after: snapshot(row) });
    return res.status(201).json({ row });
  } catch (err) { return next(err); }
}

// PUT /api/operator-master/:id
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Number.isInteger(id) ? await repo.findById(id) : null;
    if (!existing) return bad(res, 'Not found', 'NOT_FOUND', 404);
    const v = validate(req.body || {}, existing);
    if (v.error) return bad(res, v.error, v.code);
    const renamed = v.value.name.toLowerCase() !== existing.name.toLowerCase();
    const moved = v.value.service !== existing.service;
    if (renamed || moved) {
      const dup = await repo.findByName(v.value.service, v.value.name);
      if (dup && dup.id !== id) return bad(res, 'This operator already exists for this service', 'DUPLICATE', 409);
      // Slabs, SP keys and transactions keep the operator as text: changing its name or service would orphan them.
      const used = await repo.usage(existing.name);
      if (used.total > 0) {
        return bad(res, `${existing.name} is already used (${used.transactions} transactions, ${used.slabs} commission slabs, ${used.spKeys} SP keys, ${used.packageItems} package items), so its name and service cannot change. Switch it off and add a new operator instead.`, 'IN_USE', 409);
      }
    }
    const row = await repo.update(id, {
      name: v.value.name, service: v.value.service, category: v.value.category, code: v.value.code,
      circle_required: v.value.circleRequired, is_active: v.value.isActive,
    });
    await log(req, 'operator_updated', { before: snapshot(existing), after: snapshot(row) });
    return res.json({ row });
  } catch (err) { return next(err); }
}

// DELETE /api/operator-master/:id - only an operator nothing uses; others are switched off instead.
async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Number.isInteger(id) ? await repo.findById(id) : null;
    if (!existing) return bad(res, 'Not found', 'NOT_FOUND', 404);
    const used = await repo.usage(existing.name);
    if (used.total > 0) return bad(res, `${existing.name} is used by ${used.transactions} transactions, ${used.slabs} commission slabs, ${used.spKeys} SP keys and ${used.packageItems} package items. Switch it off instead so the records stay.`, 'IN_USE', 409);
    await repo.remove(id);
    await log(req, 'operator_deleted', { before: snapshot(existing) });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
}

module.exports = { list, groups, create, update, remove };
