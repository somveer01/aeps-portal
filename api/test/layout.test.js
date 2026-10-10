'use strict';

// Application Settings -> Layout style (classic | modern): validated, saved, and exposed to the app in /settings/public.
// Restores the saved value afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');
const settingsRepo = require('../src/repositories/settings.repo');

const PORT = 3921;
const BASE = `http://localhost:${PORT}`;
let server; let saved;
const A = async () => api(BASE, signFor(await adminUser())); // fresh token: other tests bump token_epoch

before(async () => { server = await startServer(PORT); saved = await settingsRepo.get('layout_style'); });
after(async () => {
  if (saved === null) await db('settings').where({ key: 'layout_style' }).del(); else await settingsRepo.set('layout_style', saved);
  await new Promise((r) => server.close(r));
  await db.destroy();
});

test('layout style: modern is saved and shown publicly; empty / unknown falls back to classic', async () => {
  const a = await A();
  assert.equal((await a.post('/api/settings/app', { layout_style: 'modern' })).s, 200);
  assert.equal((await a.get('/api/settings/app')).b.settings.layout_style, 'modern');
  const pub = await api(BASE, null).get('/api/settings/public');
  assert.equal(pub.b.theme.layout, 'modern');

  assert.equal((await a.post('/api/settings/app', { layout_style: '' })).s, 200);
  assert.equal((await api(BASE, null).get('/api/settings/public')).b.theme.layout, 'classic', 'empty = classic');

  const bad = await a.post('/api/settings/app', { layout_style: 'neon' });
  assert.equal(bad.s, 400);
  assert.equal(bad.b.code, 'INVALID_LAYOUT');
  assert.equal((await api(BASE, null).get('/api/settings/public')).b.theme.layout, 'classic', 'a refused value changes nothing');
});
