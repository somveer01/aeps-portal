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

// The User Type tree (user_types.parent_type_id) is the create rule: a user may create every
// type BELOW its own type at any depth (Super Distributor -> Distributor and Retailer). The walk
// goes through inactive types too (only active ones are returned) and stops at MAX_DEPTH, so a
// bad loop in old data cannot hang it.
async function typesBelow(userTypeId) {
  if (!userTypeId) return [];
  const { rows } = await db.raw(
    `WITH RECURSIVE t(id, depth) AS (
       SELECT id, 1 FROM user_types WHERE parent_type_id = ?
       UNION ALL
       SELECT c.id, t.depth + 1 FROM user_types c JOIN t ON c.parent_type_id = t.id WHERE t.depth < ?)
     SELECT ut.id, ut.name, min(t.depth)::int AS depth
       FROM t JOIN user_types ut ON ut.id = t.id
      WHERE ut.is_active AND ut.id <> ?
      GROUP BY ut.id, ut.name
      ORDER BY depth, ut.id`,
    [userTypeId, MAX_DEPTH, userTypeId],
  );
  return rows;
}

// Types ABOVE `userTypeId` (nearest first): the types whose users may sit over it.
async function typesAbove(userTypeId) {
  const out = [];
  const seen = new Set([userTypeId]);
  let cur = userTypeId ? await db('user_types').where({ id: userTypeId }).first('parent_type_id') : null;
  for (let i = 0; cur && cur.parent_type_id && !seen.has(cur.parent_type_id) && i < MAX_DEPTH; i += 1) {
    seen.add(cur.parent_type_id);
    // eslint-disable-next-line no-await-in-loop
    const t = await db('user_types').where({ id: cur.parent_type_id }).first('id', 'name', 'parent_type_id');
    if (!t) break;
    out.push({ id: t.id, name: t.name });
    cur = t;
  }
  return out;
}

module.exports = {
  MAX_DEPTH,
  downlineIds,
  typesBelow,
  typesAbove,

  // User types a user of `userTypeId` may create (every active type below it), each with its plans.
  async childTypes(userTypeId) {
    const types = (await typesBelow(userTypeId)).map(({ id, name }) => ({ id, name }));
    if (!types.length) return [];
    const plans = await db('plans').whereIn('user_type_id', types.map((t) => t.id)).where({ is_active: true }).orderBy('id').select('id', 'name', 'user_type_id');
    return types.map((t) => ({ ...t, plans: plans.filter((p) => p.user_type_id === t.id) }));
  },

  // Is `typeId` somewhere below `ancestorTypeId` in the type tree?
  async isTypeBelow(ancestorTypeId, typeId) {
    if (!ancestorTypeId || !typeId) return false;
    return (await typesBelow(ancestorTypeId)).some((t) => t.id === typeId);
  },

  // Same rule as childTypes: a type with any active type below it gets the network panel.
  async canHaveDownline(userTypeId) {
    return (await typesBelow(userTypeId)).length > 0;
  },

  // Level of `targetId` below `userId`, or null when it is not in the downline.
  async levelOf(userId, targetId) {
    if (!targetId) return null;
    const row = await downline(userId).from('d').where('d.id', targetId).first('level');
    return row ? Number(row.level) : null;
  },
};
