'use strict';

const repo = require('../repositories/payoutBank.repo');
const usersRepo = require('../repositories/usersManager.repo');
const audit = require('../repositories/audit.repo');

const clean = (v) => String(v || '').trim();
const UPLOAD_PATH = /^\/uploads\/[\w.-]+$/;
const cleanImage = (v) => { const s = clean(v); return s && UPLOAD_PATH.test(s) ? s : null; };

async function list(req, res, next) {
  try {
    const { rows, total } = await repo.list({
      startDate: clean(req.query.startDate) || null,
      endDate: clean(req.query.endDate) || null,
      userTypeId: req.query.userTypeId ? parseInt(req.query.userTypeId, 10) : null,
      userId: req.query.userId ? parseInt(req.query.userId, 10) : null,
      status: ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null,
      page: Math.max(1, parseInt(req.query.page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10)),
    });
    return res.json({ rows, total });
  } catch (err) { return next(err); }
}

function validateFields(b) {
  const bankName = clean(b.bankName), accountNo = clean(b.accountNo);
  const ifscCode = clean(b.ifscCode).toUpperCase(), acHolder = clean(b.acHolder);
  if (bankName.length < 2) return 'Bank name is required';
  if (!/^\d{6,20}$/.test(accountNo)) return 'Account number must be 6–20 digits';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) return 'Enter a valid IFSC code (e.g. HDFC0001234)';
  if (acHolder.length < 2) return 'Account holder name is required';
  return { bankName, accountNo, ifscCode, acHolder };
}

// POST /api/payout-banks  { userId, bankName, accountNo, ifscCode, acHolder, passbook }
async function create(req, res, next) {
  try {
    const userId = parseInt(req.body.userId, 10);
    if (!userId || !(await usersRepo.findFull(userId))) return res.status(400).json({ error: 'Please select a valid user', code: 'INVALID_USER' });
    const v = validateFields(req.body);
    if (typeof v === 'string') return res.status(400).json({ error: v, code: 'INVALID' });
    const id = await repo.create({ userId, ...v, passbook: cleanImage(req.body.passbook), status: 'pending' });
    return res.status(201).json({ row: await repo.findById(id) });
  } catch (err) { return next(err); }
}

// PUT /api/payout-banks/:id  — approve/reject (status) OR edit fields incl passbook
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await repo.findById(id))) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

    // status-only action (approve/reject)
    if (req.body.status !== undefined && req.body.bankName === undefined) {
      if (!['approved', 'rejected', 'pending'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status', code: 'INVALID_STATUS' });
      await repo.updateStatus(id, req.body.status, clean(req.body.remark));
      await audit.log({ userId: req.user.id, username: req.user.username, event: 'payout_bank_review', detail: { id, status: req.body.status }, ip: req.ip, userAgent: req.get('user-agent') });
      return res.json({ row: await repo.findById(id) });
    }

    // field edit
    const patch = {};
    if (req.body.userId !== undefined) {
      const uid = parseInt(req.body.userId, 10);
      if (!uid || !(await usersRepo.findFull(uid))) return res.status(400).json({ error: 'Invalid user', code: 'INVALID_USER' });
      patch.userId = uid;
    }
    if (req.body.bankName !== undefined) {
      const v = validateFields(req.body);
      if (typeof v === 'string') return res.status(400).json({ error: v, code: 'INVALID' });
      Object.assign(patch, v);
    }
    if (req.body.passbook !== undefined) patch.passbook = cleanImage(req.body.passbook);
    if (req.body.remark !== undefined) patch.remark = clean(req.body.remark);
    await repo.update(id, patch);
    return res.json({ row: await repo.findById(id) });
  } catch (err) { return next(err); }
}

module.exports = { list, create, update };
