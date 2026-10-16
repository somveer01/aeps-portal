'use strict';

const crypto = require('crypto');
const env = require('../config/env');

/**
 * Encrypts API tokens / keys before they go into the database (aes-256-gcm, Node's own crypto).
 * The key comes from PROVIDER_SECRET_KEY in the server's .env (any long random string; never in git).
 * Local mock development has a built-in key so it works with zero config; live mode and NODE_ENV=production
 * must set one - without it saving or reading a token is refused (the rest of the app keeps running).
 * Stored form: "v1:<iv>:<tag>:<ciphertext>" (base64 parts).
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

function key() {
  const raw = process.env.PROVIDER_SECRET_KEY || (env.isLive || env.isProd ? '' : 'dev-insecure-provider-secret-key');
  if (!raw) throw err(409, 'SECRET_KEY_MISSING', 'PROVIDER_SECRET_KEY is not set on the server, so API tokens cannot be saved or used.');
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(stored) {
  if (!stored) return null;
  const [v, iv, tag, data] = String(stored).split(':');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw err(500, 'SECRET_UNREADABLE', 'A stored API token is damaged; enter it again.');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch (e) {
    throw err(409, 'SECRET_UNREADABLE', 'A stored API token cannot be read with the current PROVIDER_SECRET_KEY; enter it again.');
  }
}

// "••••1234" for screens; never the token itself.
const hintOf = (plain) => (plain ? String(plain).slice(-4) : null);
const mask = (hint) => (hint ? `••••${hint}` : '');

module.exports = { encrypt, decrypt, hintOf, mask };
