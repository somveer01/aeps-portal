'use strict';

const defaultDb = require('../config/db');

/**
 * Read-only consistency check of the wallet ledger (account_transactions) against the wallets (users.wallet_balance).
 * Every money move must leave: wallet = the last ledger balance, each row = before +/- amount, each row's "before" =
 * the previous row's "after", and no negative wallet. Used by the tests (after every money flow) and by
 * `npm run check:ledger` (against any database, e.g. production through the SSH tunnel).
 * Returns [{ kind, userId, userCode, detail }]; an empty list means everything matches.
 */
async function findProblems({ db = defaultDb, userIds = null, limit = 50 } = {}) {
  const scope = userIds ? 'and u.id = any(?)' : '';
  const scopeA = userIds ? 'where a.user_id = any(?)' : '';
  const bind = userIds ? [userIds] : [];
  const out = [];

  const wallet = await db.raw(
    `select u.id, u.user_code, u.wallet_balance, l.updated_balance
       from users u join lateral (select updated_balance from account_transactions a where a.user_id = u.id order by a.id desc limit 1) l on true
      where u.wallet_balance <> l.updated_balance ${scope} limit ${limit}`, bind);
  wallet.rows.forEach((r) => out.push({ kind: 'WALLET_NOT_LAST_LEDGER', userId: r.id, userCode: r.user_code, detail: `wallet ${r.wallet_balance} but the last ledger row says ${r.updated_balance}` }));

  const chain = await db.raw(
    `select x.user_id, u.user_code, x.id, x.before_balance, x.prev
       from (select a.user_id, a.id, a.before_balance, lag(a.updated_balance) over (partition by a.user_id order by a.id) as prev
               from account_transactions a ${scopeA}) x join users u on u.id = x.user_id
      where x.prev is not null and x.before_balance <> x.prev limit ${limit}`, bind);
  chain.rows.forEach((r) => out.push({ kind: 'LEDGER_CHAIN_BREAK', userId: r.user_id, userCode: r.user_code, detail: `row ${r.id} starts at ${r.before_balance} but the row before ended at ${r.prev}` }));

  const math = await db.raw(
    `select a.id, a.user_id, u.user_code, a.type, a.amount, a.before_balance, a.updated_balance
       from account_transactions a join users u on u.id = a.user_id
      where (case when a.type = 'credit' then a.before_balance + a.amount else a.before_balance - a.amount end) <> a.updated_balance ${userIds ? 'and a.user_id = any(?)' : ''} limit ${limit}`, bind);
  math.rows.forEach((r) => out.push({ kind: 'LEDGER_ROW_MATH', userId: r.user_id, userCode: r.user_code, detail: `row ${r.id}: ${r.before_balance} ${r.type === 'credit' ? '+' : '-'} ${r.amount} is not ${r.updated_balance}` }));

  const negative = await db.raw(`select u.id, u.user_code, u.wallet_balance from users u where u.wallet_balance < 0 ${scope} limit ${limit}`, bind);
  negative.rows.forEach((r) => out.push({ kind: 'NEGATIVE_WALLET', userId: r.id, userCode: r.user_code, detail: `wallet ${r.wallet_balance}` }));

  return out;
}

module.exports = { findProblems };
