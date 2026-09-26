'use strict';

const repo = require('../repositories/companyBank.repo');
const bankRepo = require('../repositories/bank.repo');

const clean = (v) => String(v || '').trim();

// GET /api/banks -> bank master options for the dropdown
async function listBanks(req, res, next) {
  try { return res.json({ banks: await bankRepo.listActive() }); } catch (err) { return next(err); }
}

async function list(req, res, next) {
  try {
    const q = clean(req.query.q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const { rows, total } = await repo.list({ q, page, pageSize });
    return res.json({ rows, total, page, pageSize });
  } catch (err) { return next(err); }
}

async function validate(body) {
  const bankId = parseInt(body.bankId, 10);
  const bank = bankId ? await bankRepo.findById(bankId) : null;
  if (!bank) return 'Please select a bank';
  const accountHolder = clean(body.accountHolder);
  const accountNo = clean(body.accountNo), ifscCode = clean(body.ifscCode).toUpperCase();
  if (accountHolder.length < 2) return 'Account holder name is required';
  if (!/^\d{6,20}$/.test(accountNo)) return 'Account number must be 6–20 digits';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) return 'Enter a valid IFSC code (e.g. HDFC0001234)';
  return { bankId, bankName: bank.name, accountHolder, accountNo, ifscCode };
}

async function create(req, res, next) {
  try {
    const v = await validate(req.body);
    if (typeof v === 'string') return res.status(400).json({ error: v, code: 'INVALID' });
    return res.status(201).json({ row: await repo.create({ ...v, isActive: req.body.isActive !== false }) });
  } catch (err) { return next(err); }
}

async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    // status-only quick toggle
    if (Object.keys(req.body).length === 1 && req.body.isActive !== undefined) {
      return res.json({ row: await repo.update(id, { isActive: !!req.body.isActive }) });
    }
    const v = await validate(req.body);
    if (typeof v === 'string') return res.status(400).json({ error: v, code: 'INVALID' });
    return res.json({ row: await repo.update(id, { ...v, isActive: req.body.isActive }) });
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

module.exports = { list, create, update, remove, listBanks };
