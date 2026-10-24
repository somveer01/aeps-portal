'use strict';

const db = require('../config/db');
const serviceNames = require('./serviceNames');
const permission = require('./servicePermission.service');

/**
 * Checks run before any paid service (and AEPS balance / mini statement):
 *   1. the user's KYC is verified;
 *   2. the service is switched on in Service Master;
 *   3. the user may use it (Service Permissions: user override, else the user type default);
 *   4. today's successful amount for this user + service stays within its daily limit.
 * A service that is NOT in Service Master is refused (403 SERVICE_NOT_CONFIGURED): with no row nothing could switch it off, limit
 * it or say who may use it, so it must not run. (Names the app sends: services/serviceNames.js, checked at startup / in /api/health.)
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

// Pipeline service names that are titled differently in Service Master.
const ALIASES = { fastag: 'fastag recharge', 'nsdl pan card': 'pan card' };

async function findService(name, trx = db) {
  const key = String(name || '').trim().toLowerCase();
  const titles = [key, ALIASES[key]].filter(Boolean);
  return trx('services').whereRaw(`lower(title) in (${titles.map(() => '?').join(',')})`, titles)
    .orderBy('id').first('id', 'title', 'is_active', 'daily_limit');
}

// Every name the app may have stored for a service (its title and the aliases that point at it), lower case: transactions keep the name
// they were sent with, so the daily limit must add them up together (FASTag and Fastag Recharge are one service).
const namesOf = (svc) => {
  const title = String(svc.title).trim().toLowerCase();
  return [title, ...Object.keys(ALIASES).filter((k) => ALIASES[k] === title)];
};

/** The service names the app sends that have no Service Master row (should be none). */
async function missingNames(trx = db) {
  const out = [];
  for (const name of serviceNames.ALL) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await findService(name, trx))) out.push(name);
  }
  return out;
}

// Is `svc` usable given the user's allowed service ids (a Set)? Unlisted services need KYC only. (Used by the catalogue.)
const allowedFor = (svc, allowed) => !svc || allowed.has(svc.id);

/** Throws a 403/400 with a clear code when the user may not run `serviceName` for `amount`. */
async function check({ trx = db, userId, serviceName, amount = 0 }) {
  const user = await trx('users').where({ id: userId }).first('kyc_status');
  if (!user || user.kyc_status !== 'verified') {
    throw err(403, 'KYC_REQUIRED', `Complete your KYC before using services (KYC status: ${user ? user.kyc_status || 'pending' : 'unknown'}).`);
  }
  const svc = await findService(serviceName, trx);
  if (!svc) throw err(403, 'SERVICE_NOT_CONFIGURED', `${serviceName} is not set up in Service Master yet. Please contact the admin.`);
  if (!svc.is_active) throw err(403, 'SERVICE_OFF', `${svc.title} is switched off right now. Please try again later.`);
  if (!(await permission.can(userId, svc, trx))) {
    throw err(403, 'NO_SERVICE_ACCESS', `${svc.title} is not enabled for your account. Please contact the admin.`);
  }
  const limit = Number(svc.daily_limit);
  if (limit > 0 && Number(amount) > 0) {
    // Pending ones count too: they hold money and may still succeed, and a request in flight must not let a second one slip past the limit.
    const row = await trx('service_transactions').where({ user_id: userId }).whereIn('status', ['success', 'pending'])
      .whereRaw('lower(service) = any(?)', [namesOf(svc)]).whereRaw('created_at::date = CURRENT_DATE')
      .sum('amount as used').first();
    const used = Number(row.used || 0);
    if (used + Number(amount) > limit) {
      const left = Math.max(0, limit - used);
      throw err(400, 'DAILY_LIMIT', `Daily limit for ${svc.title} is ₹${limit.toFixed(2)}. You can use ₹${left.toFixed(2)} more today.`);
    }
  }
  return svc;
}

module.exports = { check, findService, allowedFor, missingNames, namesOf };
