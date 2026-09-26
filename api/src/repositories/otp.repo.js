'use strict';

const db = require('../config/db');

const TABLE = 'otp_requests';

module.exports = {
  create({ userId, otpHash, purpose = 'login', expiresAt }) {
    return db(TABLE)
      .insert({
        user_id: userId,
        otp_hash: otpHash,
        purpose,
        expires_at: expiresAt,
      })
      .returning('*')
      .then((rows) => rows[0]);
  },

  /** Number of OTPs sent to this user today (calendar day, DB time). */
  countSentToday(userId) {
    return db(TABLE)
      .where({ user_id: userId })
      .andWhereRaw('created_at::date = CURRENT_DATE')
      .count('id as c')
      .first()
      .then((row) => Number(row.c));
  },

  /** Latest unconsumed OTP for a user + purpose. */
  findLatestActive(userId, purpose = 'login') {
    return db(TABLE)
      .where({ user_id: userId, purpose })
      .whereNull('consumed_at')
      .orderBy('created_at', 'desc')
      .first();
  },

  incrementVerifyAttempts(id) {
    return db(TABLE).where({ id }).increment('verify_attempts', 1);
  },

  markConsumed(id) {
    return db(TABLE).where({ id }).update({ consumed_at: db.fn.now() });
  },
};
