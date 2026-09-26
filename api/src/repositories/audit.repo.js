'use strict';

const db = require('../config/db');

const TABLE = 'audit_log';

module.exports = {
  /**
   * Append an audit event. Never throws into the request path — auditing must
   * not break login; failures are logged and swallowed.
   */
  async log({ userId = null, username = null, event, ip = null, userAgent = null, detail = null }) {
    try {
      await db(TABLE).insert({
        user_id: userId,
        username: username ? String(username).slice(0, 120) : null,
        event,
        ip: ip ? String(ip).slice(0, 64) : null,
        user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
        detail: detail ? JSON.stringify(detail) : null,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('audit_log write failed:', err.message);
    }
  },
};
