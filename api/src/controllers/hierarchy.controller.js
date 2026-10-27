'use strict';

const db = require('../config/db');

// Hierarchy Tree (admin): every managed user with the user it sits under, so the screen can draw Admin -> Super Distributor ->
// Distributor -> Retailer, plus the User Type Master tree (types, their parent type and depth) that decides which parent a user may have
// (the screen marks users that sit outside it). Read only. The tree and the counts are built by the screen from these flat lists.
const MAX_ROWS = 20000;

// Depth of every user type in the User Type tree: a type with no parent type = 1, its child types 2, ... (a loop in bad data stops).
function typeDepths(types) {
  const byId = new Map(types.map((t) => [t.id, t]));
  return types.map((t) => {
    let depth = 1; let p = t.parent_type_id; const seen = new Set([t.id]);
    while (p && byId.has(p) && !seen.has(p)) { seen.add(p); depth += 1; p = byId.get(p).parent_type_id; }
    return { id: t.id, name: t.name, parentTypeId: t.parent_type_id || null, depth };
  });
}

// GET /api/hierarchy-tree
async function tree(req, res, next) {
  try {
    const types = typeDepths(await db('user_types').orderBy('id').select('id', 'name', 'parent_type_id'));
    const rows = await db('users as u')
      .leftJoin('user_types as t', 't.id', 'u.user_type_id')
      .leftJoin('users as p', 'p.id', 'u.parent_id')
      .whereNotNull('u.user_type_id')
      .orderBy('u.id')
      .limit(MAX_ROWS + 1)
      .select('u.id', 'u.user_code', 'u.full_name', 'u.mobile', 'u.user_type_id', 't.name as user_type_name',
        'u.parent_id', 'p.role as parent_role', 'u.wallet_balance', 'u.is_active', 'u.kyc_status');
    const truncated = rows.length > MAX_ROWS;
    const list = (truncated ? rows.slice(0, MAX_ROWS) : rows).map((r) => ({
      id: r.id, userCode: r.user_code, name: r.full_name, mobile: r.mobile, userTypeId: r.user_type_id, userType: r.user_type_name,
      // under the admin (or nobody) = a top-level user
      parentId: r.parent_role === 'admin' ? null : r.parent_id,
      walletBalance: Number(r.wallet_balance || 0), isActive: !!r.is_active, kycStatus: r.kyc_status,
    }));
    return res.json({ rows: list, total: list.length, truncated, types });
  } catch (e) { return next(e); }
}

module.exports = { tree };
