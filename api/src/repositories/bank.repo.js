'use strict';

const db = require('../config/db');

module.exports = {
  listActive() { return db('banks').where({ is_active: true }).orderBy('name', 'asc').select('id', 'name'); },
  findById(id) { return db('banks').where({ id }).first(); },
};
