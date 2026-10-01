'use strict';

const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const env = require('../config/env');
const audit = require('../repositories/audit.repo');
const { KYC_DIR } = require('../middleware/upload');

/**
 * KYC: a managed user uploads documents; the admin approves or rejects with a reason.
 * Document images are private. Lists hand out short-lived signed links
 * (/api/kyc/files/:name?t=...) that work in <img> tags without an auth header.
 */
const clean = (v) => String(v || '').trim();
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const FILE_FIELDS = ['aadhaar_front', 'aadhaar_back', 'pan_card', 'shop_photo', 'selfie', 'bank_proof'];
const FILE_RE = /^[a-f0-9]{32}\.(png|jpg|webp)$/;
const FILE_TTL = '15m';

const fileLink = (name) => (name ? `/api/kyc/files/${name}?t=${jwt.sign({ f: name, stage: 'kycfile' }, env.jwt.secret, { expiresIn: FILE_TTL })}` : null);
function withLinks(row) {
  if (!row) return row;
  const out = { ...row, files: {} };
  FILE_FIELDS.forEach((k) => { out.files[k] = fileLink(row[k]); delete out[k]; });
  return out;
}

// POST /api/kyc/upload (multipart "image") — returns the private file name to submit.
async function upload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload', code: 'NO_FILE' });
  return res.status(201).json({ name: req.file.filename });
}

// GET /api/kyc/files/:name?t= — a signed, short-lived link to one document.
async function file(req, res) {
  const name = String(req.params.name || '');
  try {
    const p = jwt.verify(String(req.query.t || ''), env.jwt.secret);
    if (p.stage !== 'kycfile' || p.f !== name || !FILE_RE.test(name)) throw new Error('bad');
  } catch { return res.status(403).json({ error: 'This link has expired. Reload the page.', code: 'LINK_EXPIRED' }); }
  const full = path.join(KYC_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'private, no-store');
  return res.sendFile(full);
}

// GET /api/my/kyc — my KYC status and latest submission.
async function mine(req, res, next) {
  try {
    const u = await db('users').where({ id: req.user.id }).first('kyc_status');
    const latest = await db('kyc_submissions').where({ user_id: req.user.id }).orderBy('id', 'desc').first();
    return res.json({ kycStatus: u.kyc_status, submission: withLinks(latest) });
  } catch (e) { return next(e); }
}

async function ownsUploads(userId, names) {
  // A file must exist and must not already belong to someone else's submission.
  for (const n of names) {
    if (!FILE_RE.test(n) || !fs.existsSync(path.join(KYC_DIR, n))) return false;
    // eslint-disable-next-line no-await-in-loop
    const used = await db('kyc_submissions').where((w) => FILE_FIELDS.forEach((f) => w.orWhere(f, n))).whereNot({ user_id: userId }).first('id');
    if (used) return false;
  }
  return true;
}

// POST /api/my/kyc — submit documents for review.
async function submit(req, res, next) {
  try {
    const b = req.body || {};
    const u = await db('users').where({ id: req.user.id }).first('kyc_status');
    if (u.kyc_status === 'verified') throw err(409, 'ALREADY_VERIFIED', 'Your KYC is already verified');
    if (await db('kyc_submissions').where({ user_id: req.user.id, status: 'pending' }).first('id')) throw err(409, 'ALREADY_PENDING', 'Your KYC is already under review');

    const aadhaar = clean(b.aadhaarNumber).replace(/\s|-/g, '');
    if (!/^\d{12}$/.test(aadhaar)) throw err(400, 'INVALID_AADHAAR', 'Enter your 12-digit Aadhaar number');
    if (!/^[2-9]/.test(aadhaar)) throw err(400, 'INVALID_AADHAAR', 'Aadhaar number cannot start with 0 or 1');
    const pan = clean(b.panNumber).toUpperCase();
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw err(400, 'INVALID_PAN', 'Enter a valid PAN (e.g. ABCDE1234F)');
    const bankName = clean(b.bankName); const holder = clean(b.accountHolder);
    const acc = clean(b.accountNo).replace(/\s/g, ''); const ifsc = clean(b.ifscCode).toUpperCase();
    if (bankName.length < 2 || holder.length < 2) throw err(400, 'INVALID_BANK', 'Enter the bank name and account holder name');
    if (!/^\d{6,20}$/.test(acc)) throw err(400, 'INVALID_ACCOUNT', 'Enter a valid bank account number');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw err(400, 'INVALID_IFSC', 'Enter a valid IFSC (e.g. SBIN0001234)');

    const files = {
      aadhaar_front: clean(b.aadhaarFront), aadhaar_back: clean(b.aadhaarBack), pan_card: clean(b.panCard),
      shop_photo: clean(b.shopPhoto), selfie: clean(b.selfie), bank_proof: clean(b.bankProof) || null,
    };
    const required = ['aadhaar_front', 'aadhaar_back', 'pan_card', 'shop_photo', 'selfie'];
    if (required.some((k) => !files[k])) throw err(400, 'MISSING_DOCUMENT', 'Upload Aadhaar front and back, PAN card, shop photo and a selfie');
    if (!(await ownsUploads(req.user.id, Object.values(files).filter(Boolean)))) throw err(400, 'INVALID_DOCUMENT', 'Upload the documents again');

    let id;
    await db.transaction(async (trx) => {
      const [row] = await trx('kyc_submissions').insert({
        user_id: req.user.id, status: 'pending', aadhaar_last4: aadhaar.slice(-4), pan_number: pan,
        bank_name: bankName, account_holder: holder, account_no: acc, ifsc_code: ifsc, ...files,
      }).returning('id');
      id = typeof row === 'object' ? row.id : row;
      await trx('users').where({ id: req.user.id }).update({ kyc_status: 'pending', updated_at: trx.fn.now() });
    }).catch((e) => { if (e.code === '23505') throw err(409, 'ALREADY_PENDING', 'Your KYC is already under review'); throw e; });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'kyc_submitted', detail: { id }, ...meta(req) });
    return res.status(201).json({ submission: withLinks(await db('kyc_submissions').where({ id }).first()) });
  } catch (e) { return send(e, res, next); }
}

const LIST_COLS = ['k.*', 'u.user_code', 'u.full_name as user_name', 'u.mobile as user_mobile', 'u.shop_name as outlet_name',
  'ut.name as user_type_name', db.raw("coalesce(nullif(rv.user_code, ''), rv.username) as reviewed_by_code")];
const listJoins = () => db('kyc_submissions as k').join('users as u', 'u.id', 'k.user_id')
  .leftJoin('user_types as ut', 'ut.id', 'u.user_type_id').leftJoin('users as rv', 'rv.id', 'k.reviewed_by');

// GET /api/kyc-requests?status=pending&q=
async function adminList(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
    const q = clean(req.query.q);
    const filter = (qb) => {
      if (status) qb.where('k.status', status);
      if (q) qb.andWhere((w) => w.whereILike('u.full_name', `%${q}%`).orWhereILike('u.user_code', `%${q}%`).orWhereILike('u.mobile', `%${q}%`).orWhereILike('k.pan_number', `%${q}%`));
    };
    const countRow = await listJoins().where(filter).count('k.id as c').first();
    const rows = await listJoins().where(filter).select(LIST_COLS).orderBy('k.id', status === 'pending' ? 'asc' : 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return res.json({ rows: rows.map(withLinks), total: Number(countRow.c), page, pageSize });
  } catch (e) { return next(e); }
}

// PUT /api/kyc-requests/:id { status: 'approved'|'rejected', remark }
async function adminAct(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const status = req.body && req.body.status;
    const remark = clean(req.body && req.body.remark).slice(0, 500);
    if (!['approved', 'rejected'].includes(status)) throw err(400, 'INVALID_STATUS', 'Choose approve or reject');
    if (status === 'rejected' && remark.length < 3) throw err(400, 'REASON_REQUIRED', 'Write the reason so the user can fix it');

    await db.transaction(async (trx) => {
      const k = await trx('kyc_submissions').where({ id }).forUpdate().first();
      if (!k) throw err(404, 'NOT_FOUND', 'Not found');
      if (k.status !== 'pending') throw err(409, 'ALREADY_REVIEWED', 'This KYC was already reviewed');
      await trx('kyc_submissions').where({ id }).update({ status, review_remark: remark || null, reviewed_by: req.user.id, reviewed_at: trx.fn.now(), updated_at: trx.fn.now() });
      const patch = { kyc_status: status === 'approved' ? 'verified' : 'rejected', updated_at: trx.fn.now() };
      if (status === 'approved') patch.pan_number = k.pan_number;
      await trx('users').where({ id: k.user_id }).update(patch);
    });
    await audit.log({ userId: req.user.id, username: req.user.username, event: status === 'approved' ? 'kyc_approved' : 'kyc_rejected', detail: { id }, ...meta(req) });
    const row = await listJoins().where('k.id', id).select(LIST_COLS).first();
    return res.json({ row: withLinks(row) });
  } catch (e) { return send(e, res, next); }
}

function send(e, res, next) {
  if (e.status && e.code) return res.status(e.status).json({ error: e.message, code: e.code });
  return next(e);
}

module.exports = { upload, file, mine, submit, adminList, adminAct };
