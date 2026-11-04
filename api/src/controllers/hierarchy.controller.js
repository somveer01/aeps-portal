'use strict';

const db = require('../config/db');
const { typeDepths } = require('../utils/typeTree');
const { downlineIds } = require('../repositories/network.repo');

// Hierarchy Tree: every managed user with the user it sits under, so the screen can draw Admin -> Super Distributor ->
// Distributor -> Retailer, plus the User Type Master tree (types, their parent type and depth) that decides which parent a user may have
// (the screen marks users that sit outside it). Read only. The tree and the counts are built by the screen from these flat lists.
// Admin sees the whole network; a Super Distributor / Distributor sees only the users below them (GET /api/network/hierarchy-tree).
const MAX_ROWS = 20000;

const baseQuery = () => db('users as u')
  .leftJoin('user_types as t', 't.id', 'u.user_type_id')
  .leftJoin('users as p', 'p.id', 'u.parent_id')
  .whereNotNull('u.user_type_id')
  .orderBy('u.id')
  .limit(MAX_ROWS + 1)
  .select('u.id', 'u.user_code', 'u.full_name', 'u.mobile', 'u.user_type_id', 't.name as user_type_name',
    'u.parent_id', 'p.role as parent_role', 'u.wallet_balance', 'u.is_active', 'u.kyc_status');

// parentId(r) says which parent the screen should hang the user under (null = a top-level user)
const shape = (rows, parentId) => {
  const truncated = rows.length > MAX_ROWS;
  const list = (truncated ? rows.slice(0, MAX_ROWS) : rows).map((r) => ({
    id: r.id, userCode: r.user_code, name: r.full_name, mobile: r.mobile, userTypeId: r.user_type_id, userType: r.user_type_name,
    parentId: parentId(r),
    walletBalance: Number(r.wallet_balance || 0), isActive: !!r.is_active, kycStatus: r.kyc_status,
  }));
  return { rows: list, total: list.length, truncated };
};
const typeRows = async () => typeDepths(await db('user_types').orderBy('id').select('id', 'name', 'parent_type_id'));

// GET /api/hierarchy-tree (admin)
async function tree(req, res, next) {
  try {
    const types = await typeRows();
    // under the admin (or nobody) = a top-level user
    const out = shape(await baseQuery(), (r) => (r.parent_role === 'admin' ? null : r.parent_id));
    return res.json({ ...out, types });
  } catch (e) { return next(e); }
}

// GET /api/network/hierarchy-tree (Super Distributor / Distributor: requireManaged + requireNetwork)
// Only the caller's own downline, at every level. The users directly under the caller are the top level of the tree. `me` is the root.
async function networkTree(req, res, next) {
  try {
    const me = await db('users as u').leftJoin('user_types as t', 't.id', 'u.user_type_id').where('u.id', req.user.id)
      .first('u.id', 'u.user_code', 'u.full_name', 't.name as user_type_name');
    const types = await typeRows();
    const out = shape(await baseQuery().whereIn('u.id', downlineIds(req.user.id)), (r) => (r.parent_id === req.user.id ? null : r.parent_id));
    return res.json({ ...out, types, me: { id: me.id, userCode: me.user_code, name: me.full_name, userType: me.user_type_name } });
  } catch (e) { return next(e); }
}

module.exports = { tree, networkTree };
