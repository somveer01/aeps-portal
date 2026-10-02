'use strict';

// Wrong OTPs: the user stays on the OTP step with "N attempts left"; the attempt that reaches the
// limit ends the login (TOO_MANY_ATTEMPTS). Same for a real SMS OTP and the dev master OTP.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { db, startServer, api } = require('./helper');
const env = require('../src/config/env');
const otp = require('../src/services/otp.service');
const token = require('../src/services/token.service');

const PORT = 3930;
const BASE = `http://localhost:${PORT}`;
const TAG = `otp${Date.now()}`;
let server; let user;
const saved = { master: env.devMasterOtp, nodeEnv: env.nodeEnv, max: env.otp.maxVerifyAttempts };
const sms = async (code) => db('otp_requests').insert({ user_id: user.id, otp_hash: await bcrypt.hash(code, 4), purpose: 'login', expires_at: new Date(Date.now() + 300000) });

before(async () => {
  server = await startServer(PORT);
  const ut = await db('user_types').orderBy('id').first('id');
  [user] = await db('users').insert({
    username: TAG, user_code: TAG, password_hash: 'x', mobile: '9000000004', full_name: 'Otp Test', role: 'user', user_type_id: ut.id, wallet_balance: 0, kyc_status: 'verified',
  }).returning(['id', 'username', 'mobile']);
  env.otp.maxVerifyAttempts = 3;
});

after(async () => {
  Object.assign(env, { devMasterOtp: saved.master, nodeEnv: saved.nodeEnv });
  env.otp.maxVerifyAttempts = saved.max;
  await db('audit_log').where({ user_id: user.id }).del();
  await db('otp_requests').where({ user_id: user.id }).del();
  await db('users').where({ id: user.id }).del();
  server.close();
  await db.destroy();
});

test('real OTP: two wrong tries say how many are left, the third ends the login', async () => {
  Object.assign(env, { devMasterOtp: '', nodeEnv: 'production' });
  await sms('246810');
  assert.deepEqual(await otp.verifyOtp(user.id, '111111'), { ok: false, reason: 'mismatch', attemptsLeft: 2 });
  assert.deepEqual(await otp.verifyOtp(user.id, '222222'), { ok: false, reason: 'mismatch', attemptsLeft: 1 });
  assert.deepEqual(await otp.verifyOtp(user.id, '333333'), { ok: false, reason: 'too_many_attempts' });
  assert.equal((await otp.verifyOtp(user.id, '246810')).reason, 'too_many_attempts', 'right code is too late');
  await db('otp_requests').where({ user_id: user.id }).del();
  await sms('135790');
  assert.equal((await otp.verifyOtp(user.id, '000000')).attemptsLeft, 2);
  assert.deepEqual(await otp.verifyOtp(user.id, '135790'), { ok: true }, 'a fresh OTP works after a wrong try');
  await db('otp_requests').where({ user_id: user.id }).del();
});

test('dev master OTP: 123456 still works; wrong codes get 3 tries, then the login ends', async () => {
  Object.assign(env, { devMasterOtp: '123456', nodeEnv: 'development' });
  await otp.issueOtp(user);
  assert.deepEqual(await otp.verifyOtp(user.id, '654321'), { ok: false, reason: 'mismatch', attemptsLeft: 2 });
  assert.deepEqual(await otp.verifyOtp(user.id, '111111'), { ok: false, reason: 'mismatch', attemptsLeft: 1 });
  assert.deepEqual(await otp.verifyOtp(user.id, '222222'), { ok: false, reason: 'too_many_attempts' });
  assert.equal((await otp.verifyOtp(user.id, '333333')).reason, 'too_many_attempts', 'stays locked');
  await otp.issueOtp(user); // logging in again starts a fresh count
  assert.equal((await otp.verifyOtp(user.id, '999999')).attemptsLeft, 2);
  assert.deepEqual(await otp.verifyOtp(user.id, '123456'), { ok: true });
});

test('verify-otp endpoint returns the attempts left and the end-of-login code', async () => {
  Object.assign(env, { devMasterOtp: '123456', nodeEnv: 'development' });
  await otp.issueOtp(user);
  const P = api(BASE, token.signPending(user.id));
  const r1 = await P.post('/api/auth/verify-otp', { otp: '000001' });
  assert.equal(r1.s, 401);
  assert.equal(r1.b.code, 'MISMATCH');
  assert.equal(r1.b.attemptsLeft, 2);
  assert.match(r1.b.error, /2 attempts left/);
  const r2 = await P.post('/api/auth/verify-otp', { otp: '000002' });
  assert.match(r2.b.error, /1 attempt left/);
  const r3 = await P.post('/api/auth/verify-otp', { otp: '000003' });
  assert.equal(r3.s, 429);
  assert.equal(r3.b.code, 'TOO_MANY_ATTEMPTS');
  await otp.issueOtp(user);
  const ok = await P.post('/api/auth/verify-otp', { otp: '123456' });
  assert.equal(ok.s, 200);
  assert.ok(ok.b.accessToken);
});

test('dev master OTP: a leftover expired OTP row does not bounce a wrong try to login', async () => {
  Object.assign(env, { devMasterOtp: '123456', nodeEnv: 'development' });
  // An SMS OTP from before master mode was switched on, never used and long expired.
  await db('otp_requests').insert({ user_id: user.id, otp_hash: await bcrypt.hash('555555', 4), purpose: 'login', expires_at: new Date(Date.now() - 3600000) });
  await otp.issueOtp(user);
  assert.deepEqual(await otp.verifyOtp(user.id, '000000'), { ok: false, reason: 'mismatch', attemptsLeft: 2 }, 'not "expired"');
  assert.deepEqual(await otp.verifyOtp(user.id, '000001'), { ok: false, reason: 'mismatch', attemptsLeft: 1 });
  assert.deepEqual(await otp.verifyOtp(user.id, '000002'), { ok: false, reason: 'too_many_attempts' });
  await otp.issueOtp(user);
  assert.deepEqual(await otp.verifyOtp(user.id, '123456'), { ok: true });
  // Outside master mode an expired OTP still ends the login.
  Object.assign(env, { devMasterOtp: '', nodeEnv: 'production' });
  assert.equal((await otp.verifyOtp(user.id, '000000')).reason, 'expired');
  await db('otp_requests').where({ user_id: user.id }).del();
});
