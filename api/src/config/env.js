'use strict';

/**
 * Centralized, typed access to environment configuration.
 * Everything environment-specific (DB, secrets, OTP policy, SMS provider)
 * is read here so the rest of the app never touches process.env directly.
 */
require('dotenv').config();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// eslint-disable-next-line global-require
const pkg = require('../../package.json');

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  get isProd() {
    return this.nodeEnv === 'production';
  },
  port: int(process.env.PORT, 3000),
  version: pkg.version,

  // Explicit run mode for external adapters (KYC, SMS, email, etc).
  // Defaults to 'mock' and is NEVER inferred from whether a key happens to be
  // set — live mode must be opted into with APP_MODE/MODE=live.
  appMode: (process.env.APP_MODE || process.env.MODE || 'mock').toLowerCase(),
  get isLive() {
    return this.appMode === 'live' || this.appMode === 'production';
  },

  // Provider callbacks are signed with HMAC-SHA256 of the raw body (header x-signature).
  // Local mock development has a built-in secret so it works with zero config; live mode
  // and any NODE_ENV=production deployment must set one (else callbacks are refused).
  get providerCallbackSecret() {
    return process.env.PROVIDER_CALLBACK_SECRET || (this.isLive || this.isProd ? null : 'mock-callback-secret');
  },
  // Background jobs (started by server.js, never by tests): status check of pending
  // transactions and the daily reconciliation of yesterday's transactions.
  jobs: {
    enabled: (process.env.JOBS_ENABLED || 'true').toLowerCase() !== 'false',
    statusCheckEverySec: int(process.env.STATUS_CHECK_INTERVAL_SECONDS, 300),
    pendingMinAgeSec: int(process.env.PENDING_MIN_AGE_SECONDS, 60),
    reconHour: int(process.env.RECON_HOUR, 1), // run yesterday's reconciliation after this hour (server time)
  },

  // JWT auth (replaces cookie sessions so the native app works too).
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-insecure-jwt-secret',
    accessTtl: process.env.JWT_ACCESS_TTL || '8h', // full session after OTP
    pendingTtl: process.env.JWT_PENDING_TTL || '10m', // between password and OTP
  },

  // Comma-separated list of allowed web origins for CORS (Expo web dev server).
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:8081,http://localhost:19006')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Database — DATABASE_URL wins; otherwise assemble from discrete PG* vars.
  db: {
    connectionString: process.env.DATABASE_URL || null,
    host: process.env.PGHOST || 'localhost',
    port: int(process.env.PGPORT, 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'fintech_aeps',
    ssl: bool(process.env.PGSSL, false),
  },

  // Dev-only: echo the generated captcha answer to the server log so local /
  // automated testing can complete login without OCR. MUST stay false in prod.
  captchaDevEcho: bool(process.env.CAPTCHA_DEV_ECHO, false),

  // Dev-only: a fixed "master" OTP that always works, skips the SMS send and
  // bypasses the daily limit. Set to '' (empty) to disable. IGNORED in production.
  devMasterOtp: (process.env.DEV_MASTER_OTP || '').trim(),

  otp: {
    length: int(process.env.OTP_LENGTH, 6),
    ttlSeconds: int(process.env.OTP_TTL_SECONDS, 300),
    dailyLimit: int(process.env.OTP_DAILY_LIMIT, 5),
    maxVerifyAttempts: int(process.env.OTP_MAX_VERIFY_ATTEMPTS, 3), // wrong OTPs allowed before the login starts over
  },

  // Per-account brute-force lockout for the password step.
  login: {
    maxFailed: int(process.env.LOGIN_MAX_FAILED, 5),
    lockoutMinutes: int(process.env.LOGIN_LOCKOUT_MINUTES, 15),
  },

  sms: {
    provider: (process.env.SMS_PROVIDER || 'dev').toLowerCase(),
    msg91: {
      authKey: process.env.MSG91_AUTH_KEY || '',
      senderId: process.env.MSG91_SENDER_ID || '',
      templateId: process.env.MSG91_TEMPLATE_ID || '',
    },
  },

  seedAdmin: {
    username: process.env.SEED_ADMIN_USERNAME || 'admin',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
    fullName: process.env.SEED_ADMIN_FULLNAME || 'Portal Administrator',
    mobile: process.env.SEED_ADMIN_MOBILE || '9999999999',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  },
};

/**
 * Build the connection object shared by knex and connect-pg-simple.
 * Returns either a connection string form or a discrete config object.
 */
env.buildPgConnection = function buildPgConnection() {
  if (env.db.connectionString) {
    return env.db.ssl
      ? { connectionString: env.db.connectionString, ssl: { rejectUnauthorized: false } }
      : { connectionString: env.db.connectionString };
  }
  const conn = {
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
  };
  if (env.db.ssl) conn.ssl = { rejectUnauthorized: false };
  return conn;
};

module.exports = env;
