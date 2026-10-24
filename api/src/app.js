'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./config/env');
const db = require('./config/db');
const serviceGuard = require('./services/serviceGuard.service');
const apiRoutes = require('./routes/api.routes');
const { UPLOAD_DIR } = require('./middleware/upload');

const app = express();

if (env.isProd) app.set('trust proxy', 1);

// Allow images to be embedded cross-origin (login page on :8081 loads /uploads).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Serve uploaded images. KYC documents under _private are only reachable through the
// authenticated /api/kyc/files route, never here.
app.use('/uploads', (req, res, next) => {
  let p;
  try { p = decodeURIComponent(req.path).replace(/\\/g, '/'); } catch { return res.status(400).json({ error: 'Bad path' }); }
  if (/^\/*_private(\/|$)/i.test(p)) return res.status(404).json({ error: 'Not found' }); // also blocks %5F / case tricks
  return next();
}, express.static(UPLOAD_DIR, { dotfiles: 'deny' }));
app.use(
  cors({
    origin(origin, cb) {
      // Allow no-origin (native apps, curl) and any configured web origin.
      if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: false,
  }),
);
// Keep the raw body so the provider callback's HMAC signature can be checked.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Health check — reports run mode, active adapters, and version so it's clear
// which implementations are live without reading the code.
// `providers` lists the APIs from API Management and the adapter each one really runs on (always mock in mock mode).
app.get('/api/health', async (req, res) => {
  let providers = [];
  try {
    providers = (await db('api_providers').orderBy('id').select('code', 'adapter', 'is_active'))
      .map((p) => ({ code: p.code, adapter: p.adapter, active: p.is_active, runsOn: env.isLive ? p.adapter : 'mock' }));
  } catch (e) { providers = null; } // database not reachable / not migrated: health still answers
  // Service names the app sends that have no Service Master row (they are refused until the admin adds them): should be empty.
  let missingServices = [];
  try { missingServices = await serviceGuard.missingNames(); } catch (e) { missingServices = null; }
  res.json({
    ok: true,
    service: 'aeps-api',
    version: env.version,
    mode: env.appMode,
    adapters: {
      sms: env.isLive ? env.sms.provider : 'dev',
      kyc: env.isLive ? 'live' : 'mock',
      email: env.isLive ? 'smtp' : 'dev',
      db: 'postgres',
    },
    providers,
    missingServices,
  });
});

app.use('/api', apiRoutes);

// 404 (JSON).
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler (JSON). Validation/known errors carry a status + code; unknown
// errors are masked in production.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  const body = { error: status >= 500 && env.isProd ? 'Internal server error' : err.message };
  if (err.code) body.code = err.code;
  res.status(status).json(body);
});

module.exports = app;
