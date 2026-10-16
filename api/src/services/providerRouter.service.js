'use strict';

const db = require('../config/db');
const registry = require('./providers');
const serviceGuard = require('./serviceGuard.service');

/**
 * Which API (provider) one transaction goes through, decided BEFORE the wallet is debited:
 *   1. Customer Switch - the user's own API for this service (user_service_routes);
 *   2. Product Switch  - the service's API (service_routes);
 *   3. otherwise the built-in Mock Provider (code MOCK) - today's behaviour.
 * Then the API's SP key + commission for this service: the row for the exact operator (or the IMPS / NEFT mode),
 * else the "All operators" row (operator ''). Whether the service is on, and whether this user may use it, is
 * serviceGuard's job (Service Master + Service Permissions), not this one.
 *
 * Returns { providerId, providerCode, providerName, adapter, spKey, product, api } - `api` is what providerCall uses.
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const PROVIDER_COLS = ['id', 'name', 'code', 'adapter', 'base_url', 'username', 'password_enc', 'secret_enc', 'extra_enc', 'is_active'];

const lc = (v) => String(v || '').trim().toLowerCase();

/** Best SP key row of `providerId` for a service: exact operator, then mode, then all operators. */
async function productFor(trx, providerId, serviceId, { operator, mode } = {}) {
  if (!serviceId) return null;
  const rows = await trx('provider_products').where({ provider_id: providerId, service_id: serviceId, is_active: true })
    .select('id', 'operator', 'sp_key', 'commission_type', 'commission_value');
  const pick = (name) => (name ? rows.find((r) => r.operator && lc(r.operator) === lc(name)) : null);
  return pick(operator) || pick(mode) || rows.find((r) => r.operator === '') || null;
}

async function resolve({ trx = db, userId, serviceName, service, operator = null, mode = null }) {
  const svc = service || await serviceGuard.findService(serviceName, trx);
  let provider = null;
  if (svc) {
    const own = userId ? await trx('user_service_routes').where({ user_id: userId, service_id: svc.id }).first('provider_id') : null;
    const route = own || await trx('service_routes').where({ service_id: svc.id }).first('provider_id');
    if (route) provider = await trx('api_providers').where({ id: route.provider_id }).first(PROVIDER_COLS);
  }
  if (!provider) provider = await trx('api_providers').where({ code: 'MOCK' }).first(PROVIDER_COLS);
  // No Mock row at all (a database older than the API Management migration): the plain global adapter.
  if (!provider) return { providerId: null, providerCode: null, providerName: null, adapter: null, spKey: null, product: null, api: registry.apiFor(null) };

  const title = svc ? svc.title : serviceName;
  if (!provider.is_active) throw err(409, 'PROVIDER_OFF', `${title} is temporarily unavailable. Please try again later.`);
  const product = await productFor(trx, provider.id, svc && svc.id, { operator, mode });
  if (registry.needsSpKey(provider.adapter) && !(product && product.sp_key)) {
    throw err(409, 'PROVIDER_NOT_MAPPED', `${title}${operator ? ` (${operator})` : ''} is not set up on ${provider.name} yet. Please contact the admin.`);
  }
  return {
    providerId: provider.id, providerCode: provider.code, providerName: provider.name, adapter: provider.adapter,
    spKey: product ? product.sp_key || null : null, product, api: registry.apiFor(provider),
  };
}

/** The callable API for a recorded transaction (status check / reconciliation). */
async function apiForProviderId(providerId, trx = db) {
  const row = providerId ? await trx('api_providers').where({ id: providerId }).first(PROVIDER_COLS) : null;
  return registry.apiFor(row);
}

module.exports = { resolve, productFor, apiForProviderId };
