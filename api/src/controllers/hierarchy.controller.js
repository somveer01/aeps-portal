'use strict';

const db = require('../config/db');
const { typeDepths } = require('../utils/typeTree');

// Hierarchy Tree (admin): every managed user with the user it sits under, so the screen can draw Admin -> Super Distributor ->
// Distributor -> Retailer, plus the User Type Master tree (types, their parent type and depth) that decides which parent a user may have
// (the screen marks users that sit outside it). Read only. The tree and the counts are built by the screen from these flat lists.
const MAX_ROWS = 20000;

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
