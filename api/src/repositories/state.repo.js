'use strict';

const db = require('../config/db');

const TABLE = 'states';

module.exports = {
  listActive() {
    return db(TABLE).where({ is_active: true }).orderBy('name', 'asc').select('id', 'name');
  },
  findById(id) {
    return db(TABLE).where({ id }).first();
  },
};
