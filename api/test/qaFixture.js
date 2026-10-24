'use strict';

// Shared fixture for the qa_retailer_*.test.js files (not a test itself): a throwaway user type that may use the
// retailer services, one or two KYC-verified retailers with a funded wallet, and helpers that read the wallet / ledger /
// transaction rows. Everything it creates is removed by cleanup().
const bcrypt = require('bcryptjs');
const { db, startServer, api, signFor } = require('./helper');
const { findProblems } = require('../src/services/ledgerCheck.service');

const idOf = (r) => (typeof r === 'object' ? r.id : r);
const PASSWORD = 'Test@1234';

// Every service the retailer money endpoints use (titles as in Service Master).
const ALL_TITLES = ['Mobile Recharge', 'DTH Recharge', 'Bill Payment', 'LIC Payment', 'Gas Booking', 'Fastag Recharge', 'Move To Bank', 'AEPS', 'Aadhar Pay', 'Micro ATM', 'Money Transfer', 'Flight Booking', 'Hotel Booking', 'Bus Booking'];

async function create({ prefix, port, wallet = 1000 }) {
  const TAG = `${prefix}${Date.now().toString(36)}`;
  const BASE = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  const typeId = idOf((await db('user_types').insert({ name: `${TAG} type` }).returning('id'))[0]);
  const svcRows = await db('services').whereIn('title', ALL_TITLES).select('id', 'title', 'is_active', 'daily_limit');
  const svcId = Object.fromEntries(svcRows.map((s) => [s.title, s.id]));
  await db('user_type_services').insert(svcRows.map((s) => ({ user_type_id: typeId, service_id: s.id })));
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const userIds = [];
  const mkUser = async (key, balance = wallet) => {
    const id = idOf((await db('users').insert({
      username: `${TAG}${key}`, user_code: `${TAG}${key}`, password_hash: passwordHash, mobile: '9000000000',
      full_name: `QA ${key}`, role: 'user', user_type_id: typeId, wallet_balance: balance, kyc_status: 'verified',
    }).returning('id'))[0]);
    userIds.push(id);
    return { id, token: signFor(await db('users').where({ id }).first()), username: `${TAG}${key}` };
  };
  const main = await mkUser('a');
  const ctx = {
    TAG, BASE, typeId, svcId, userId: main.id, token: main.token, userIds, PASSWORD, mkUser,
    http: (tok = main.token) => api(BASE, tok),
    wallet: async (id = main.id) => Number((await db('users').where({ id }).first('wallet_balance')).wallet_balance),
    // wallet back to `balance`, all money rows of the user gone (so the wallet and an empty ledger agree)
    reset: async (balance = wallet, id = main.id) => {
      await db('commission_ledger').where({ user_id: id }).del();
      await db('admin_margins').where({ user_id: id }).del();
      await db('account_transactions').where({ user_id: id }).del();
      await db('service_transactions').where({ user_id: id }).del();
      await db('bookings').where({ retailer_id: id }).del();
      await db('users').where({ id }).update({ wallet_balance: balance, kyc_status: 'verified' });
    },
    txns: (id = main.id) => db('service_transactions').where({ user_id: id }).orderBy('id'),
    ledger: (id = main.id) => db('account_transactions').where({ user_id: id }).orderBy('id'),
    problems: (label, ids = userIds) => findProblems({ userIds: ids }).then((p) => {
      if (p.length) throw new Error(`${label}: ledger problems ${JSON.stringify(p)}`);
    }),
    setService: (title, patch) => db('services').where({ id: svcId[title] }).update(patch),
    cleanup: async () => {
      await db('idempotency_keys').whereIn('user_id', userIds).del();
      await db('commission_ledger').whereIn('user_id', userIds).del();
      await db('admin_margins').whereIn('user_id', userIds).del();
      await db('account_transactions').whereIn('user_id', userIds).del();
      await db('service_transactions').whereIn('user_id', userIds).del();
      await db('bookings').whereIn('retailer_id', userIds).del();
      await db('audit_log').whereIn('username', await db('users').whereIn('id', userIds).pluck('username')).del().catch(() => {});
      await db('commission_slots').where({ user_type_id: typeId }).del();
      await db('plans').where({ user_type_id: typeId }).del();
      await db('user_service_overrides').whereIn('user_id', userIds).del();
      await db('users').whereIn('id', userIds).del(); // dmt senders / beneficiaries go with the users (ON DELETE CASCADE)
      await db('user_type_services').where({ user_type_id: typeId }).del();
      await db('user_types').where({ id: typeId }).del();
      server.close();
      await db.destroy();
    },
  };
  return ctx;
}

module.exports = { create, PASSWORD, ALL_TITLES, idOf };
