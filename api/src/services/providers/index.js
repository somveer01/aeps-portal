'use strict';

const env = require('../../config/env');
const providers = require('../providers.service');
const secretBox = require('../../utils/secretBox');

/**
 * Adapter registry: turns an api_providers row into the object the money pipeline calls
 * (same shape as providers.service.js: recharge.recharge, bbps.pay, aeps.transact, dmt.transfer, booking.book,
 * status, report, ...).
 *
 *  - APP_MODE=mock (default): EVERY API runs on the mock adapter, whatever the screens say, so development and tests
 *    never move real money. (The very providers.service object is returned, so a test can stub it.)
 *  - APP_MODE=live: the API's own adapter. An adapter that is not written yet answers PROVIDER_NOT_CONFIGURED.
 *
 * Adding a real provider later = one file in ./adapters/<code>.js exporting create(cfg) -> that same shape (plus
 * ping / balance), and one line in ADAPTERS below. `cfg` is the decrypted row: { baseUrl, username, token, extra }.
 */
const ADAPTERS = {
  mock: { label: 'Demo / Mock (test data, no real money)', needsSpKey: false, create: () => providers.liveStub },
  custom: { label: 'Integration pending (adapter not written yet)', needsSpKey: true, create: () => providers.liveStub },
};

const adapterList = () => Object.entries(ADAPTERS).map(([key, a]) => ({ key, label: a.label, needsSpKey: a.needsSpKey }));
const needsSpKey = (adapter) => !!(ADAPTERS[adapter] || ADAPTERS.custom).needsSpKey;

// Decrypted connection details of one row; only ever handed to an adapter, never sent to a screen.
function configOf(row) {
  let extra = {};
  try { extra = row.extra_enc ? JSON.parse(secretBox.decrypt(row.extra_enc)) : {}; } catch (e) { extra = {}; }
  return { code: row.code, baseUrl: row.base_url, username: row.username, token: secretBox.decrypt(row.secret_enc), extra };
}

/** The callable API for a provider row (null row = the default). */
function apiFor(row) {
  if (!env.isLive) return providers;
  const a = row && ADAPTERS[row.adapter];
  if (!a || row.adapter === 'mock') return providers.liveStub;
  return a.create(configOf(row));
}

/** Test Connection. Mock mode makes no outside call. */
async function ping(row) {
  if (!env.isLive) return { ok: true, mode: 'mock', message: 'Mock mode: no real call was made. The connection is tested when APP_MODE=live.' };
  const api = apiFor(row);
  if (typeof api.ping !== 'function') return { ok: false, mode: 'live', message: `The "${row.adapter}" adapter is not written yet, so this API cannot be called.` };
  const r = await api.ping();
  return { ok: !!(r && r.ok), mode: 'live', message: (r && r.message) || 'Connected', balance: r && r.balance != null ? Number(r.balance) : null };
}

module.exports = { ADAPTERS, adapterList, needsSpKey, apiFor, ping, configOf };
