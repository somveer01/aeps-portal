'use strict';

const db = require('../config/db');

/**
 * Idempotency for money-mutating POSTs / PUTs. The client sends a unique `Idempotency-Key` header per user action; a
 * retry with the same key returns the original response instead of executing the operation twice. The header is
 * REQUIRED: without it nothing stops a double-click or a retried request from moving the money twice (the app sends one
 * on every money call).
 *
 * Race-safe: the key is RESERVED (inserted with status 0) before the handler runs, so two concurrent requests with
 * the same key cannot both execute - the second hits the unique constraint and is short-circuited. On success the row
 * is finalized with the response; on failure it is removed so the client can legitimately retry.
 *
 * A reservation still "in progress" after STALE_MINUTES belongs to a request that died (no real request runs that
 * long): it is released so the key is not blocked forever. A key reused on a DIFFERENT endpoint is refused (it would
 * replay the wrong answer).
 */
const STALE_MINUTES = 5;

const log = (msg) => {
  // eslint-disable-next-line no-console
  console.warn(`[idempotency] ${msg}`);
};

async function reserve(userId, key, endpoint) {
  await db('idempotency_keys').insert({ user_id: userId, idem_key: key, endpoint, response_status: 0 });
}

module.exports = async function idempotency(req, res, next) {
  const userId = req.user && req.user.id;
  if (!userId) return next();
  const key = String(req.get('idempotency-key') || '').trim();
  if (!key) {
    return res.status(400).json({ error: 'This action needs an Idempotency-Key header (a unique value per action), so a retry can never move the money twice.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  if (key.length > 100) return res.status(400).json({ error: 'The Idempotency-Key is too long (100 characters at most).', code: 'IDEMPOTENCY_KEY_INVALID' });

  const endpoint = `${req.method} ${req.originalUrl.split('?')[0]}`.slice(0, 120);

  // Try to reserve the key.
  try {
    await reserve(userId, key, endpoint);
  } catch (e) {
    // Duplicate key -> either completed (replay the stored response), still in flight, or a dead reservation.
    let existing = null;
    try { existing = await db('idempotency_keys').where({ user_id: userId, idem_key: key }).first(); } catch (lookupErr) { log(`lookup failed: ${lookupErr.message}`); }
    if (existing && existing.endpoint !== endpoint) {
      return res.status(409).json({ error: 'This Idempotency-Key was already used for a different request.', code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    if (existing && existing.response_status > 0) {
      res.set('Idempotent-Replay', 'true');
      return res.status(existing.response_status).json(JSON.parse(existing.response_body || '{}'));
    }
    const ageMs = existing ? Date.now() - new Date(existing.created_at).getTime() : 0;
    if (existing && ageMs > STALE_MINUTES * 60 * 1000) {
      // The request that made this reservation died: release it (only if it is still unfinished) and take the key.
      try {
        await db('idempotency_keys').where({ id: existing.id, response_status: 0 }).del();
        await reserve(userId, key, endpoint);
        return capture(req, res, next, userId, key);
      } catch (retakeErr) { log(`could not release a stale reservation: ${retakeErr.message}`); }
    }
    return res.status(409).json({ error: 'A matching request is already being processed', code: 'IDEMPOTENT_IN_PROGRESS' });
  }
  return capture(req, res, next, userId, key);
};

// Run the handler and persist its response on the reserved key (or free the key when it failed).
function capture(req, res, next, userId, key) {
  let captured;
  const origJson = res.json.bind(res);
  res.json = (body) => { captured = body; return origJson(body); };

  res.on('finish', () => {
    const q = db('idempotency_keys').where({ user_id: userId, idem_key: key });
    const op = res.statusCode >= 200 && res.statusCode < 300
      ? q.update({ response_status: res.statusCode, response_body: JSON.stringify(captured == null ? {} : captured) })
      : q.del(); // failed: free the key so the client can retry
    op.catch((e) => log(`could not save the result of ${key} (user ${userId}): ${e.message}`));
  });

  return next();
}
