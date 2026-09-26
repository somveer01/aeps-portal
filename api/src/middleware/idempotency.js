'use strict';

const db = require('../config/db');

/**
 * Idempotency for money-mutating POSTs. The client sends a unique
 * `Idempotency-Key` header per user action; a retry with the same key returns
 * the original response instead of executing the operation twice.
 *
 * Race-safe: the key is RESERVED (inserted with status 0) before the handler
 * runs, so two concurrent requests with the same key cannot both execute — the
 * second hits the unique constraint and is short-circuited. On success the row
 * is finalized with the response; on failure it is removed so the client can
 * legitimately retry.
 *
 * If no key is supplied the request proceeds normally (no dedupe).
 */
module.exports = async function idempotency(req, res, next) {
  const key = String(req.get('idempotency-key') || '').trim();
  const userId = req.user && req.user.id;
  if (!key || !userId) return next();

  const endpoint = `${req.method} ${req.originalUrl.split('?')[0]}`.slice(0, 120);

  // Try to reserve the key.
  try {
    await db('idempotency_keys').insert({ user_id: userId, idem_key: key, endpoint, response_status: 0 });
  } catch (e) {
    // Duplicate key -> either completed (replay the stored response) or still in flight.
    const existing = await db('idempotency_keys').where({ user_id: userId, idem_key: key }).first().catch(() => null);
    if (existing && existing.response_status > 0) {
      res.set('Idempotent-Replay', 'true');
      return res.status(existing.response_status).json(JSON.parse(existing.response_body || '{}'));
    }
    return res.status(409).json({ error: 'A matching request is already being processed', code: 'IDEMPOTENT_IN_PROGRESS' });
  }

  // Capture the response body so it can be persisted on success.
  let captured;
  const origJson = res.json.bind(res);
  res.json = (body) => { captured = body; return origJson(body); };

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      db('idempotency_keys').where({ user_id: userId, idem_key: key })
        .update({ response_status: res.statusCode, response_body: JSON.stringify(captured == null ? {} : captured) })
        .catch(() => {});
    } else {
      // Failed — free the key so the client can retry.
      db('idempotency_keys').where({ user_id: userId, idem_key: key }).del().catch(() => {});
    }
  });

  return next();
};
