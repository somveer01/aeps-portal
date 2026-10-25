'use strict';

const { safeCompare } = require('../utils/safe');
const db = require('../config/db');

/**
 * Verify a user's transaction credential. If the user has set a dedicated
 * transaction PIN (`txn_pin_hash`), that is checked; otherwise it falls back to
 * the account login password. This lets the separate-PIN feature roll out
 * without breaking existing flows that pass the login password.
 * Returns true/false; never throws for a wrong credential.
 */
async function verify(userId, provided) {
  const value = String(provided || '');
  if (!value) return false;
  const user = await db('users').where({ id: userId }).first('password_hash', 'txn_pin_hash');
  if (!user) return false;
  return safeCompare(value, user.txn_pin_hash || user.password_hash);
}

module.exports = { verify };
