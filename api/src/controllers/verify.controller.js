'use strict';

const bcrypt = require('bcryptjs');
const db = require('../config/db');
const kyc = require('../services/kyc.service');
const audit = require('../repositories/audit.repo');
const { match, ValidationError } = require('../utils/validate');

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^\d{12}$/;

// Mask a document number for storage/audit (never store the full value).
const maskPan = (p) => `${p.slice(0, 2)}XXXXX${p.slice(-2)}`;
const maskAadhaar = (a) => `XXXX-XXXX-${a.slice(-4)}`;

async function logKyc(row) {
  try { await db('kyc_verifications').insert(row); } catch { /* audit is best-effort */ }
}

// POST /api/verify/pan  { panNumber }
async function pan(req, res, next) {
  try {
    const panNumber = match(String(req.body.panNumber || '').toUpperCase(), PAN_RE, 'PAN (e.g. ABCDE1234F)', 'INVALID_PAN');
    const result = await kyc.verifyPan(panNumber);
    await logKyc({ admin_id: req.user.id, kind: 'pan', doc_number: maskPan(panNumber), name: result.name, status: 'verified', remark: `${kyc.mode} verification` });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'kyc_pan_verify', detail: { pan: maskPan(panNumber), mode: kyc.mode }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.json(result);
  } catch (err) { return next(err); }
}

// POST /api/verify/aadhaar  { aadhaarNumber, transactionPassword }
async function aadhaar(req, res, next) {
  try {
    const aadhaarNumber = match(String(req.body.aadhaarNumber || '').replace(/\s|-/g, ''), AADHAAR_RE, '12-digit Aadhaar number', 'INVALID_AADHAAR');

    const admin = await db('users').where({ id: req.user.id }).first('password_hash');
    const okPw = admin && await bcrypt.compare(String(req.body.transactionPassword || ''), admin.password_hash);
    if (!okPw) throw Object.assign(new ValidationError('Invalid transaction password', 'BAD_TXN_PASSWORD'), { status: 401 });

    const result = await kyc.sendAadhaarOtp(aadhaarNumber);
    await logKyc({ admin_id: req.user.id, kind: 'aadhaar', doc_number: maskAadhaar(aadhaarNumber), status: 'otp_sent', ref_id: result.refId, remark: `${kyc.mode} OTP dispatch` });
    await audit.log({ userId: req.user.id, username: req.user.username, event: 'kyc_aadhaar_otp', detail: { aadhaar: maskAadhaar(aadhaarNumber), mode: kyc.mode }, ip: req.ip, userAgent: req.get('user-agent') });
    return res.json(result);
  } catch (err) { return next(err); }
}

module.exports = { pan, aadhaar };
