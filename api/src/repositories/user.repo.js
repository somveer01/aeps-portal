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

  setPassword(id, passwordHash) {
    return db(TABLE).where({ id }).update({ password_hash: passwordHash, updated_at: db.fn.now() }).then(() => db(TABLE).where({ id }).increment('token_epoch', 1));
  },
};
