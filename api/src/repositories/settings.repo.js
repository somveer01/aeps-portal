'use strict';

const db = require('../config/db');

const TABLE = 'settings';

module.exports = {
  async get(key) {
    const row = await db(TABLE).where({ key }).first();
    return row ? row.value : null;
  },

  async set(key, value) {
    await db(TABLE)
      .insert({ key, value, updated_at: db.fn.now() })
      .onConflict('key')
      .merge({ value, updated_at: db.fn.now() });
  },
};
