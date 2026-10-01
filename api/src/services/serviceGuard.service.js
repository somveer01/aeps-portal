'use strict';

const db = require('../config/db');
const permission = require('./servicePermission.service');

/**
 * Checks run before any paid service (and AEPS balance / mini statement):
 *   1. the user's KYC is verified;
 *   2. the service is switched on in Service Master;
 *   3. the user may use it (Service Permissions: user override, else the user type default);
 *   4. today's successful amount for this user + service stays within its daily limit.
 * Services that are not in Service Master (e.g. Gas Booking) get the KYC check only.
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

// Is `svc` usable given the user's allowed service ids (a Set)? Unlisted services need KYC only. (Used by the catalogue.)
const allowedFor = (svc, allowed) => !svc || allowed.has(svc.id);

/** Throws a 403/400 with a clear code when the user may not run `serviceName` for `amount`. */
async function check({ trx = db, userId, serviceName, amount = 0 }) {
  const user = await trx('users').where({ id: userId }).first('kyc_status');
  if (!user || user.kyc_status !== 'verified') {
    throw err(403, 'KYC_REQUIRED', `Complete your KYC before using services (KYC status: ${user ? user.kyc_status || 'pending' : 'unknown'}).`);
  }
  const svc = await findService(serviceName, trx);
  if (!svc) return null;
  if (!svc.is_active) throw err(403, 'SERVICE_OFF', `${svc.title} is switched off right now. Please try again later.`);
  if (!(await permission.can(userId, svc, trx))) {
    throw err(403, 'NO_SERVICE_ACCESS', `${svc.title} is not enabled for your account. Please contact the admin.`);
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

module.exports = { check, findService, allowedFor };
