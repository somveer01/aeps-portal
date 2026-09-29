'use strict';

const db = require('../config/db');

/**
 * Checks run before any paid service (and AEPS balance / mini statement):
 *   1. the user's KYC is verified;
 *   2. the service is switched on in Service Master;
 *   3. the user has access to it (an empty Service Access list means every service);
 *   4. today's successful amount for this user + service stays within its daily limit.
 * Services that are not in Service Master (e.g. Gas Booking) get the KYC check only.
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

// Pipeline service names that are titled differently in Service Master.
const ALIASES = { fastag: 'fastag recharge' };

async function findService(name, trx = db) {
  const key = String(name || '').trim().toLowerCase();
  const titles = [key, ALIASES[key]].filter(Boolean);
  return trx('services').whereRaw(`lower(title) in (${titles.map(() => '?').join(',')})`, titles)
    .orderBy('id').first('id', 'title', 'is_active', 'daily_limit');
}

function accessList(v) {
  if (!v) return [];
  const list = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(list) ? list.map(Number).filter(Number.isFinite) : [];
}

// Is `svc` usable for a user whose Service Access list is `access`? (Used by the catalogue.)
const allowedFor = (svc, access) => !svc || (svc.is_active && (!access.length || access.includes(svc.id)));

/** Throws a 403/400 with a clear code when the user may not run `serviceName` for `amount`. */
async function check({ trx = db, userId, serviceName, amount = 0 }) {
  const user = await trx('users').where({ id: userId }).first('kyc_status', 'service_access');
  if (!user || user.kyc_status !== 'verified') {
    throw err(403, 'KYC_REQUIRED', `Complete your KYC before using services (KYC status: ${user ? user.kyc_status || 'pending' : 'unknown'}).`);
  }
  const svc = await findService(serviceName, trx);
  if (!svc) return null;
  if (!svc.is_active) throw err(403, 'SERVICE_OFF', `${svc.title} is switched off right now. Please try again later.`);
  const access = accessList(user.service_access);
  if (access.length && !access.includes(svc.id)) {
    throw err(403, 'NO_SERVICE_ACCESS', `Your account does not have access to ${svc.title}. Ask the person who created your account to enable it.`);
  }
  const limit = Number(svc.daily_limit);
  if (limit > 0 && Number(amount) > 0) {
    const row = await trx('service_transactions').where({ user_id: userId, status: 'success' })
      .whereRaw('lower(service) = lower(?)', [serviceName]).whereRaw('created_at::date = CURRENT_DATE')
      .sum('amount as used').first();
    const used = Number(row.used || 0);
    if (used + Number(amount) > limit) {
      const left = Math.max(0, limit - used);
      throw err(400, 'DAILY_LIMIT', `Daily limit for ${svc.title} is ₹${limit.toFixed(2)}. You can use ₹${left.toFixed(2)} more today.`);
    }
  }
  return svc;
}

module.exports = { check, findService, accessList, allowedFor };
