'use strict';

// My Profile: a signed-in user (admin or managed) reads and edits only their own name / email / photo.
// Mobile and the KYC fields are read-only, the email needs the current password, a KYC-verified user cannot rename
// themselves. Throwaway type and users, removed afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api, adminUser, signFor } = require('./helper');

const PORT = 3918;
const BASE = `http://localhost:${PORT}`;
const TAG = `pf${Date.now()}`;
const PASS = 'Profile#123';
let server; let admin; let typeId; let userId; let verifiedId;
const idOf = (row) => (typeof row === 'object' ? row.id : row);
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch
const asUser = async (id) => api(BASE, signFor(await db('users').where({ id }).first()));
const row = (id) => db('users').where({ id }).first();

async function mkUser(suffix, extra = {}) {
  const [u] = await db('users').insert({
    username: `${TAG}${suffix}`, user_code: `${TAG}${suffix}`, password_hash: await bcrypt.hash(PASS, 4), mobile: '9000000000', full_name: 'Pro File',
    first_name: 'Pro', last_name: 'File', email: 'pro.file@example.com', role: 'user', user_type_id: typeId, parent_id: admin.id, created_by: admin.id,
    wallet_balance: 12.5, kyc_status: 'pending', ...extra,
  }).returning('id');
  return idOf(u);
}

before(async () => {
  server = await startServer(PORT);
  admin = await adminUser();
  const [t] = await db('user_types').insert({ name: `${TAG} R` }).returning('id');
  typeId = idOf(t);
  userId = await mkUser('u');
  verifiedId = await mkUser('v', { kyc_status: 'verified' });
});

after(async () => {
  await db('audit_log').where('event', 'profile_updated').whereIn('user_id', [userId, verifiedId, admin.id]).whereRaw("created_at > now() - interval '1 hour'").del();
  await db('users').whereIn('id', [userId, verifiedId]).del();
  await db('user_types').where({ id: typeId }).del();
  server.close();
  await db.destroy();
});

test('GET profile: own data only, read-only fields included, no password or PIN hashes', async () => {
  const me = await asUser(userId);
  const r = await me.get('/api/account/profile');
  assert.equal(r.s, 200, JSON.stringify(r.b));
  const p = r.b.profile;
  assert.equal(p.id, userId);
  assert.deepEqual([p.firstName, p.middleName, p.lastName, p.fullName], ['Pro', '', 'File', 'Pro File']);
  assert.equal(p.email, 'pro.file@example.com');
  assert.equal(p.mobile, '9000000000');
  assert.equal(p.balance, 12.5);
  assert.equal(p.kycStatus, 'pending');
  assert.equal(p.photo, null);
  assert.ok(!JSON.stringify(r.b).match(/hash/i), 'no hashes in the answer');

  const a = await (await A()).get('/api/account/profile');
  assert.equal(a.b.profile.role, 'admin');
  assert.equal(a.b.profile.kycStatus, null);
  assert.equal((await api(BASE, null).get('/api/account/profile')).s, 401);
});

test('PUT profile: name parts, partial edit keeps the rest, validation, mobile and role ignored', async () => {
  const me = await asUser(userId);
  const r = await me.put('/api/account/profile', { firstName: ' Neel ', middleName: 'Kumar', lastName: 'Rao' });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.deepEqual([r.b.profile.firstName, r.b.profile.middleName, r.b.profile.lastName, r.b.profile.fullName], ['Neel', 'Kumar', 'Rao', 'Neel Kumar Rao']);
  assert.equal((await row(userId)).full_name, 'Neel Kumar Rao');

  const only = await me.put('/api/account/profile', { lastName: 'Verma' });
  assert.equal(only.b.profile.fullName, 'Neel Kumar Verma', 'a part left out keeps its saved value');

  const noLast = await me.put('/api/account/profile', { lastName: '  ' });
  assert.equal(noLast.s, 400);
  assert.equal(noLast.b.code, 'INVALID_NAME');

  const sneaky = await me.put('/api/account/profile', { mobile: '9111111111', role: 'admin', walletBalance: 99999, shopName: 'Hacked' });
  assert.equal(sneaky.s, 200);
  const u = await row(userId);
  assert.equal(u.mobile, '9000000000', 'mobile cannot be changed here');
  assert.equal(u.role, 'user');
  assert.equal(Number(u.wallet_balance), 12.5);
  assert.equal(u.shop_name, null);
});

test('email change needs the current password; a bad email is refused; the same email needs nothing', async () => {
  const me = await asUser(userId);
  const noPass = await me.put('/api/account/profile', { email: 'new.mail@example.com' });
  assert.equal(noPass.s, 401);
  assert.equal(noPass.b.code, 'BAD_CURRENT');
  assert.equal((await row(userId)).email, 'pro.file@example.com');

  const wrong = await me.put('/api/account/profile', { email: 'new.mail@example.com', currentPassword: 'nope-nope' });
  assert.equal(wrong.s, 401);

  const bad = await me.put('/api/account/profile', { email: 'not-an-email', currentPassword: PASS });
  assert.equal(bad.s, 400);
  assert.equal(bad.b.code, 'INVALID_EMAIL');

  const ok = await me.put('/api/account/profile', { email: 'new.mail@example.com', currentPassword: PASS });
  assert.equal(ok.s, 200, JSON.stringify(ok.b));
  assert.equal(ok.b.profile.email, 'new.mail@example.com');

  const same = await me.put('/api/account/profile', { email: 'new.mail@example.com' });
  assert.equal(same.s, 200, 'saving the same email again needs no password');
});

test('photo: only an /uploads/ path, empty removes it', async () => {
  const me = await asUser(userId);
  for (const bad of ['http://evil.example/x.png', '/etc/passwd', '/uploads/../secret.png', 'javascript:alert(1)']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await me.put('/api/account/profile', { photo: bad });
    assert.equal(r.s, 400, bad);
    assert.equal(r.b.code, 'INVALID_PHOTO');
  }
  const ok = await me.put('/api/account/profile', { photo: '/uploads/avatar-1.png' });
  assert.equal(ok.s, 200);
  assert.equal(ok.b.profile.photo, '/uploads/avatar-1.png');
  const gone = await me.put('/api/account/profile', { photo: '' });
  assert.equal(gone.b.profile.photo, null);
});

test('a KYC-verified user cannot rename themselves (email and photo still work); the admin can', async () => {
  const v = await asUser(verifiedId);
  const rename = await v.put('/api/account/profile', { firstName: 'Changed', lastName: 'Name' });
  assert.equal(rename.s, 403);
  assert.equal(rename.b.code, 'NAME_LOCKED');
  assert.equal((await row(verifiedId)).full_name, 'Pro File');

  const same = await v.put('/api/account/profile', { firstName: 'Pro', lastName: 'File', photo: '/uploads/v.png' });
  assert.equal(same.s, 200, 'sending the unchanged name is fine');
  assert.equal(same.b.profile.photo, '/uploads/v.png');

  const a = await A();
  const adminRename = await a.put('/api/account/profile', { firstName: admin.first_name || 'Portal', lastName: admin.last_name || 'Administrator' });
  assert.equal(adminRename.s, 200, JSON.stringify(adminRename.b));
});

test('audit: profile_updated lists the fields, never the values', async () => {
  const e = await db('audit_log').where({ event: 'profile_updated', user_id: userId }).orderBy('id', 'desc').first();
  assert.ok(e);
  const text = JSON.stringify(e.detail);
  assert.ok(!text.includes('new.mail@example.com') && !text.includes(PASS));
  assert.ok(Array.isArray(e.detail.fields));
});
