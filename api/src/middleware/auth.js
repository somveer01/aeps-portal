'use strict';

const tokenService = require('../services/token.service');
const userRepo = require('../repositories/user.repo');

/** Extract a Bearer token from the Authorization header. */
function bearer(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/**
 * Requires a valid ACCESS token AND that the account is still active and the
 * token has not been revoked. Revocation works via `users.token_epoch`: signing
 * embeds the current epoch, and bumping it (logout / password change / disable)
 * invalidates every token issued before the bump. Sets req.user from the DB row
 * (authoritative role), not just the token claims.
 */
async function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  let payload;
  try {
    payload = tokenService.verify(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (payload.stage !== 'access') return res.status(401).json({ error: 'Invalid token' });
  try {
    const user = await userRepo.findById(payload.sub);
    if (!user || user.is_active === false) return res.status(401).json({ error: 'Account is inactive', code: 'INACTIVE' });
    if ((user.token_epoch || 0) !== (payload.epoch || 0)) return res.status(401).json({ error: 'Session expired, please log in again', code: 'TOKEN_REVOKED' });
    req.user = { id: user.id, username: user.username, role: user.role, userTypeId: user.user_type_id };
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Requires requireAuth to have passed AND the user to have a given role. */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Missing token' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden: insufficient privileges', code: 'FORBIDDEN' });
    return next();
  };
}

/** Convenience: valid access token + admin role. */
function requireAdmin(req, res, next) {
  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    return requireRole('admin')(req, res, next);
  });
}

/**
 * Valid access token AND a managed (retailer/distributor/employee) account —
 * i.e. any user that has a user_type_id (not the admin). This gates the retailer
 * panel; controllers additionally scope every query to req.user.id.
 */
function requireManaged(req, res, next) {
  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.userTypeId) return res.status(403).json({ error: 'Retailer account required', code: 'FORBIDDEN' });
    return next();
  });
}

/** Requires a valid PENDING token (password ok, awaiting OTP). Sets req.pendingUserId. */
function requirePending(req, res, next) {
  const token = (req.body && req.body.pendingToken) || bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing pending token' });
  try {
    const payload = tokenService.verify(token);
    if (payload.stage !== 'otp') return res.status(401).json({ error: 'Invalid pending token' });
    req.pendingUserId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired pending token' });
  }
}

module.exports = { requireAuth, requireRole, requireAdmin, requireManaged, requirePending };
