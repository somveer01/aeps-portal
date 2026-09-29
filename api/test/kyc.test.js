'use strict';

// KYC upload + admin review over HTTP, with real (tiny) image uploads. Cleans up users,
// submissions and the uploaded files.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { db, startServer, api, signFor, adminUser } = require('./helper');
const { KYC_DIR } = require('../src/middleware/upload');

const PORT = 3901;
const BASE = `http://localhost:${PORT}`;
const TAG = `kyc${Date.now()}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let server; const users = {}; const uploaded = []; let docsA;
const tok = async (key) => signFor(key === 'ADMIN' ? await adminUser() : await db('users').where({ id: users[key] }).first());

async function uploadFile(token, body = PNG, type = 'image/png') {
  const fd = new FormData();
  fd.append('image', new Blob([body], { type }), 'photo.png');
  const r = await fetch(`${BASE}/api/kyc/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const b = await r.json();
  if (b.name) uploaded.push(b.name);
  return { s: r.status, b };
}
async function mkUser(key) {
  const ut = await db('user_types').orderBy('id').first('id');
  const [row] = await db('users').insert({ username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: 'x', mobile: '9000000000', full_name: `KYC ${key}`, role: 'user', user_type_id: ut.id, kyc_status: 'pending' }).returning('id');
  users[key] = typeof row === 'object' ? row.id : row;
}
const docs = async (t) => {
  const n = [];
  for (let i = 0; i < 5; i += 1) n.push((await uploadFile(t)).b.name); // eslint-disable-line no-await-in-loop
  return { aadhaarFront: n[0], aadhaarBack: n[1], panCard: n[2], shopPhoto: n[3], selfie: n[4] };
};
const form = (extra = {}) => ({ aadhaarNumber: '2345 6789 0123', panNumber: 'abcde1234f', bankName: 'Test Bank', accountHolder: 'KYC Tester', accountNo: '123456789012', ifscCode: 'sbin0001234', ...extra });

before(async () => { server = await startServer(PORT); await mkUser('A'); await mkUser('B'); });
after(async () => {
  await db('kyc_submissions').whereIn('user_id', Object.values(users)).del();
  await db('audit_log').whereIn('user_id', Object.values(users)).del();
  await db('users').whereIn('id', Object.values(users)).del();
  uploaded.forEach((n) => { try { fs.unlinkSync(path.join(KYC_DIR, n)); } catch { /* already gone */ } });
  server.close();
  await db.destroy();
});

test('uploads are images only and never reachable on the public /uploads path', async () => {
  const t = await tok('A');
  assert.equal((await uploadFile(t, Buffer.from('hello'), 'text/plain')).b.code, 'INVALID_FILE');
  const up = await uploadFile(t);
  assert.equal(up.s, 201);
  assert.match(up.b.name, /^[a-f0-9]{32}\.png$/);
  for (const p of [`_private/kyc/${up.b.name}`, `%5Fprivate/kyc/${up.b.name}`, `_PRIVATE/kyc/${up.b.name}`]) {
    assert.equal((await fetch(`${BASE}/uploads/${p}`)).status, 404, p); // eslint-disable-line no-await-in-loop
  }
  assert.equal((await fetch(`${BASE}/api/kyc/files/${up.b.name}`)).status, 403, 'no signed link');
});

test('submit: validation, one pending at a time, only Aadhaar last 4 stored', async () => {
  const t = await tok('A');
  const d = await docs(t);
  assert.equal((await api(BASE, t).post('/api/my/kyc', form({ ...d, aadhaarNumber: '12345' }))).b.code, 'INVALID_AADHAAR');
  assert.equal((await api(BASE, t).post('/api/my/kyc', form({ ...d, panNumber: 'X1' }))).b.code, 'INVALID_PAN');
  assert.equal((await api(BASE, t).post('/api/my/kyc', form({ ...d, ifscCode: 'BAD' }))).b.code, 'INVALID_IFSC');
  assert.equal((await api(BASE, t).post('/api/my/kyc', form({ ...d, selfie: '' }))).b.code, 'MISSING_DOCUMENT');

  const ok = await api(BASE, t).post('/api/my/kyc', form(d));
  assert.equal(ok.s, 201);
  const row = await db('kyc_submissions').where({ user_id: users.A }).first();
  assert.equal(row.aadhaar_last4, '0123');
  assert.equal(row.pan_number, 'ABCDE1234F');
  assert.ok(!JSON.stringify(row).includes('234567890123'), 'full Aadhaar not stored');
  assert.equal((await api(BASE, t).post('/api/my/kyc', form(d))).b.code, 'ALREADY_PENDING');

  // The signed link from /api/my/kyc opens the private file.
  const mine = await api(BASE, t).get('/api/my/kyc');
  assert.equal((await fetch(`${BASE}${mine.b.submission.files.selfie}`)).status, 200);
  docsA = d;
});

test('another user cannot submit someone else\'s uploaded files', async () => {
  const r = await api(BASE, await tok('B')).post('/api/my/kyc', form(docsA));
  assert.equal(r.b.code, 'INVALID_DOCUMENT');
});

test('admin queue: reject needs a reason, resubmit, approve verifies the user', async () => {
  assert.equal((await api(BASE, await tok('A')).get('/api/kyc-requests')).s, 403, 'users cannot see the queue');
  const admin = await tok('ADMIN');
  const list = await api(BASE, admin).get(`/api/kyc-requests?status=pending&q=${TAG}A`);
  const sub = list.b.rows.find((x) => x.user_id === users.A);
  assert.ok(sub && sub.files.aadhaar_front, 'queue row with document links');

  assert.equal((await api(BASE, admin).put(`/api/kyc-requests/${sub.id}`, { status: 'rejected' })).b.code, 'REASON_REQUIRED');
  const rej = await api(BASE, admin).put(`/api/kyc-requests/${sub.id}`, { status: 'rejected', remark: 'Selfie is blurred' });
  assert.equal(rej.b.row.status, 'rejected');
  assert.equal((await db('users').where({ id: users.A }).first('kyc_status')).kyc_status, 'rejected');
  assert.equal((await api(BASE, await tok('A')).get('/api/my/kyc')).b.submission.review_remark, 'Selfie is blurred');

  const again = await api(BASE, await tok('A')).post('/api/my/kyc', form(docsA));
  assert.equal(again.s, 201);
  assert.equal((await db('users').where({ id: users.A }).first('kyc_status')).kyc_status, 'pending');
  const ok = await api(BASE, admin).put(`/api/kyc-requests/${again.b.submission.id}`, { status: 'approved' });
  assert.equal(ok.b.row.status, 'approved');
  const u = await db('users').where({ id: users.A }).first('kyc_status', 'pan_number');
  assert.equal(u.kyc_status, 'verified');
  assert.equal(u.pan_number, 'ABCDE1234F');
  assert.equal((await api(BASE, admin).put(`/api/kyc-requests/${again.b.submission.id}`, { status: 'rejected', remark: 'late' })).b.code, 'ALREADY_REVIEWED');
  assert.equal((await api(BASE, await tok('A')).post('/api/my/kyc', form(docsA))).b.code, 'ALREADY_VERIFIED');
});
