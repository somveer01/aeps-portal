'use strict';

const db = require('../config/db');

const TABLE = 'users';

module.exports = {
  findByUsername(username) {
    return db(TABLE).where({ username }).first();
  },

  findActiveByUsername(username) {
    return db(TABLE).where({ username, is_active: true }).first();
  },

  findById(id) {
    return db(TABLE).where({ id }).first();
  },

  /** Atomically increment failed attempts; returns the new count. */
  async incrementFailedAttempts(id) {
    const rows = await db(TABLE)
      .where({ id })
      .increment('failed_login_attempts', 1)
      .returning('failed_login_attempts');
    const row = rows[0];
    return typeof row === 'object' ? row.failed_login_attempts : row;
  },

  lockUntil(id, until) {
    return db(TABLE).where({ id }).update({ locked_until: until });
  },

  /** Clear lockout state and stamp last login (call on successful password). */
  resetLoginState(id) {
    return db(TABLE)
      .where({ id })
      .update({ failed_login_attempts: 0, locked_until: null, last_login_at: db.fn.now() });
  },

  /** Invalidate every access token issued so far (logout / password change / disable). */
  bumpTokenEpoch(id) {
    return db(TABLE).where({ id }).increment('token_epoch', 1);
  },

  // Every session dies (token_epoch + 1) and any "must change" flag is cleared: the user just chose this password.
  setPassword(id, passwordHash) {
    return db(TABLE).where({ id }).update({ password_hash: passwordHash, must_change_password: false, token_epoch: db.raw('token_epoch + 1'), updated_at: db.fn.now() });
  },

  /**
   * Admin reset: new (temporary) password, every session dead, lock cleared, the user must pick their own at next login.
   * trx: run inside the caller's transaction.
   */
  resetPassword(id, passwordHash, trx = db) {
    return trx(TABLE).where({ id }).update({
      password_hash: passwordHash, must_change_password: true, token_epoch: db.raw('token_epoch + 1'),
      failed_login_attempts: 0, locked_until: null, updated_at: db.fn.now(),
    });
  },
};
