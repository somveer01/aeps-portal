'use strict';

const crypto = require('crypto');
const svgCaptcha = require('svg-captcha');
const env = require('../config/env');

/**
 * Image captcha for a cookieless (token-based) API. Because there is no
 * session, each challenge is stored server-side under a random id with a
 * short TTL; the client receives { captchaId, svg } and later submits the
 * captchaId plus the typed answer.
 *
 * NOTE: this in-memory store is fine for a single API instance (dev / small
 * deploys). For multi-instance production, back it with Redis or a DB table.
 */
const TTL_MS = 5 * 60 * 1000;
const store = new Map(); // captchaId -> { answer, expiresAt }

function sweep() {
  const now = Date.now();
  for (const [id, v] of store) if (v.expiresAt < now) store.delete(id);
}

function generate() {
  sweep();
  const captcha = svgCaptcha.create({
    size: 5,
    noise: 3,
    color: false,
    ignoreChars: '0o1ilI',
    background: '#f2f4f8',
  });
  const captchaId = crypto.randomBytes(16).toString('hex');
  store.set(captchaId, { answer: captcha.text.toLowerCase(), expiresAt: Date.now() + TTL_MS });
  if (env.captchaDevEcho && !env.isProd) {
    // eslint-disable-next-line no-console
    console.log(`[DEV CAPTCHA] id=${captchaId.slice(0, 8)} answer=${captcha.text}`);
  }
  // svg-captcha silently forces color=true whenever a `background` is set
  // (see its lib/index.js), which can render the letters in a light,
  // hard-to-read shade. Force the character glyphs to solid black — only
  // <path fill="#hex" ...> (the letters) match; the background <rect> and
  // the fill="none" noise lines are left untouched.
  const svg = captcha.data.replace(/<path fill="#[0-9a-fA-F]{3,6}"/g, '<path fill="#000000"');
  return { captchaId, svg };
}

/** Verify and consume (single-use) a captcha challenge. */
function verify(captchaId, input) {
  const rec = store.get(captchaId);
  if (!rec) return false;
  store.delete(captchaId); // single use
  if (rec.expiresAt < Date.now()) return false;
  return String(input || '').trim().toLowerCase() === rec.answer;
}

module.exports = { generate, verify };
