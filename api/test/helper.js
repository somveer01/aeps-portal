'use strict';

// Shared test harness: boots the in-process app on a port, mints tokens, and
// provides fetch helpers. Uses the real dev database (read-mostly; tests clean
// up anything they change).
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const app = require('../src/app');
const db = require('../src/config/db');
const token = require('../src/services/token.service');

function startServer(port) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

function api(base, tok) {
  // Money endpoints REQUIRE an Idempotency-Key (the real app sends one on every money call): every POST / PUT gets a fresh one here
  // unless the test passes its own (or passes '' to prove the endpoint refuses a call without one).
  let seq = 0;
  const headers = (extra, write) => ({
    'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    ...(write && !(extra && 'Idempotency-Key' in extra) ? { 'Idempotency-Key': `t${Date.now().toString(36)}${(seq += 1)}${Math.random().toString(36).slice(2, 8)}` } : {}),
    ...extra,
  });
  return {
    get: async (p, extra) => { const r = await fetch(base + p, { headers: headers(extra) }); return { s: r.status, b: await r.json().catch(() => ({})), h: r.headers }; },
    post: async (p, body, extra) => { const r = await fetch(base + p, { method: 'POST', headers: headers(extra, true), body: JSON.stringify(body || {}) }); return { s: r.status, b: await r.json().catch(() => ({})), h: r.headers }; },
    put: async (p, body, extra) => { const r = await fetch(base + p, { method: 'PUT', headers: headers(extra, true), body: JSON.stringify(body || {}) }); return { s: r.status, b: await r.json().catch(() => ({})), h: r.headers }; },
    del: async (p, extra) => { const r = await fetch(base + p, { method: 'DELETE', headers: headers(extra) }); return { s: r.status, b: await r.json().catch(() => ({})), h: r.headers }; },
  };
}

async function adminUser() {
  return db('users').where({ role: 'admin' }).first();
}
async function anyManagedUser() {
  return db('users').whereNotNull('user_type_id').orderBy('id', 'asc').first();
}
const signFor = (user) => token.signAccess(user);

module.exports = { app, db, token, startServer, api, adminUser, anyManagedUser, signFor };
