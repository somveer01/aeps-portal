'use strict';

const db = require('../config/db');

const MAX_DEPTH = 10;

// Every user below `userId` in the parent chain, with how far down they are (1 = direct).
function downline(userId) {
  return db.withRecursive('d', ['id', 'level'], (qb) => {
    qb.select('id', db.raw('1')).from('users').where('parent_id', userId)
      .unionAll((u) => {
        u.select('c.id', db.raw('d.level + 1')).from('users as c').join('d', 'c.parent_id', 'd.id').where('d.level', '<', MAX_DEPTH);
      });
  });
}

// Sub-query of downline user ids, for `whereIn('x.user_id', downlineIds(me))`.
const downlineIds = (userId) => downline(userId).from('d').select('d.id');

module.exports = {
  MAX_DEPTH,
  downlineIds,

  // User types a user of `userTypeId` may create, each with the plans made for it.
  async childTypes(userTypeId) {
    if (!userTypeId) return [];
    const types = await db('user_types').where({ parent_type_id: userTypeId, is_active: true }).orderBy('id').select('id', 'name');
    if (!types.length) return [];
    const plans = await db('plans').whereIn('user_type_id', types.map((t) => t.id)).where({ is_active: true }).orderBy('id').select('id', 'name', 'user_type_id');
    return types.map((t) => ({ ...t, plans: plans.filter((p) => p.user_type_id === t.id) }));
  },

  async canHaveDownline(userTypeId) {
    if (!userTypeId) return false;
    return !!(await db('user_types').where({ parent_type_id: userTypeId, is_active: true }).first('id'));
  },

  // Level of `targetId` below `userId`, or null when it is not in the downline.
  async levelOf(userId, targetId) {
    if (!targetId) return null;
    const row = await downline(userId).from('d').where('d.id', targetId).first('level');
    return row ? Number(row.level) : null;
  },
};
