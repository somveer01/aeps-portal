'use strict';

// Theme colours picked from an uploaded logo: brand colours are found, white / grey / transparent areas are ignored,
// a single-colour logo gets a darker shade as the secondary, a colourless logo gets nothing, and only uploaded files are read.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { db, startServer, api, adminUser, signFor } = require('./helper');
const { UPLOAD_DIR } = require('../src/middleware/upload');

const PORT = 3919;
const BASE = `http://localhost:${PORT}`;
const TAG = `logo-test-${Date.now()}`;
const made = [];
let server;
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch
const near = (hex, rgb, tol = 40) => {
  const n = parseInt(hex.slice(1), 16);
  return Math.hypot(((n >> 16) & 255) - rgb[0], ((n >> 8) & 255) - rgb[1], (n & 255) - rgb[2]) < tol;
};
const block = (w, h, color) => ({ create: { width: w, height: h, channels: 4, background: color } });

async function mk(name, build) {
  const file = path.join(UPLOAD_DIR, `${TAG}-${name}.png`);
  await build.png().toFile(file);
  made.push(file);
  return `/uploads/${path.basename(file)}`;
}

before(async () => { server = await startServer(PORT); });
after(async () => {
  made.forEach((f) => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
  server.close();
  await db.destroy();
});

test('a two-colour logo on a white background gives its brand colours', async () => {
  const p = await mk('two', sharp({ create: { width: 200, height: 80, channels: 4, background: '#ffffff' } }).composite([
    { input: block(80, 60, '#1e2a78'), left: 10, top: 10 }, { input: block(50, 60, '#dc2626'), left: 100, top: 10 },
  ]));
  const r = await (await A()).post('/api/settings/logo-colors', { path: p });
  assert.equal(r.s, 200, JSON.stringify(r.b));
  assert.ok(near(r.b.primary, [30, 42, 120]), `primary ${r.b.primary} is the navy`);
  assert.ok(near(r.b.secondary, [220, 38, 38]), `secondary ${r.b.secondary} is the red`);
  assert.ok(r.b.palette.length >= 2 && r.b.palette.every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

test('transparent areas are ignored', async () => {
  const p = await mk('alpha', sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
    { input: block(60, 60, '#059669'), left: 30, top: 30 },
  ]));
  const r = await (await A()).post('/api/settings/logo-colors', { path: p });
  assert.equal(r.s, 200);
  assert.ok(near(r.b.primary, [5, 150, 105]), r.b.primary);
});

test('a one-colour logo gets a darker shade of it as the secondary', async () => {
  const p = await mk('one', sharp(block(100, 100, '#0891b2')));
  const r = await (await A()).post('/api/settings/logo-colors', { path: p });
  assert.ok(near(r.b.primary, [8, 145, 178]), r.b.primary);
  assert.notEqual(r.b.secondary, r.b.primary);
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
  assert.ok(lum(r.b.secondary) < lum(r.b.primary), 'darker');
});

test('a very light brand colour is darkened so the theme stays readable', async () => {
  const p = await mk('light', sharp(block(100, 100, '#ffe066')));
  const r = await (await A()).post('/api/settings/logo-colors', { path: p });
  assert.ok(r.b.primary);
  const n = parseInt(r.b.primary.slice(1), 16);
  assert.ok(((n >> 16) & 255) < 255 * 0.95 && ((n >> 8) & 255) < 224, `${r.b.primary} is darker than #ffe066`);
});

test('black / grey / white logos have no brand colour', async () => {
  const p = await mk('grey', sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff' } }).composite([
    { input: block(40, 40, '#000000'), left: 10, top: 10 }, { input: block(30, 30, '#888888'), left: 60, top: 60 },
  ]));
  const r = await (await A()).post('/api/settings/logo-colors', { path: p });
  assert.equal(r.s, 200);
  assert.deepEqual(r.b, { primary: null, secondary: null, palette: [] });
});

test('only an uploaded file is read; admin only', async () => {
  const a = await A();
  for (const bad of ['', '/etc/passwd', '/uploads/../package.json', 'http://x.example/a.png', '/uploads/sub/dir.png']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await a.post('/api/settings/logo-colors', { path: bad });
    assert.equal(r.s, 400, bad);
    assert.equal(r.b.code, 'INVALID_PATH');
  }
  assert.equal((await a.post('/api/settings/logo-colors', { path: '/uploads/does-not-exist-123.png' })).s, 404);
  const notImage = path.join(UPLOAD_DIR, `${TAG}-text.png`);
  fs.writeFileSync(notImage, 'this is not an image'); made.push(notImage);
  const bad = await a.post('/api/settings/logo-colors', { path: `/uploads/${path.basename(notImage)}` });
  assert.equal(bad.s, 400);
  assert.equal(bad.b.code, 'INVALID_IMAGE');
  assert.equal((await api(BASE, null).post('/api/settings/logo-colors', { path: '/uploads/x.png' })).s, 401);
});
