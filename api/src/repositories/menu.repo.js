'use strict';

const db = require('../config/db');

const TABLE = 'menu_items';

module.exports = {
  /** Active menu items for the given scopes ('admin' | 'retailer' | 'both'), ordered for tree assembly. */
  findAllActive(scopes = ['admin', 'both']) {
    return db(TABLE)
      .where({ is_active: true })
      .whereIn('scope', scopes)
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'id', order: 'asc' },
      ]);
  },
};
