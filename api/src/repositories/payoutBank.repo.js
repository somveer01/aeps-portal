'use strict';

const db = require('../config/db');

function joins() {
  return db('payout_banks as x')
    .join('users as u', 'u.id', 'x.user_id')
    .leftJoin('user_types as ut', 'ut.id', 'u.user_type_id');
}
const COLS = ['x.*', 'u.full_name as user_name', 'u.mobile as user_mobile', 'u.user_code', 'ut.name as user_type_name'];

module.exports = {
  async list({ startDate, endDate, userTypeId, userId, status, page = 1, pageSize = 10 } = {}) {
    const filter = (qb) => {
      if (startDate) qb.whereRaw('x.created_at::date >= ?', [startDate]);
      if (endDate) qb.whereRaw('x.created_at::date <= ?', [endDate]);
      if (userTypeId) qb.where('u.user_type_id', userTypeId);
      if (userId) qb.where('x.user_id', userId);
      if (status) qb.where('x.status', status);
    };
    const countRow = await joins().where(filter).count('x.id as c').first();
    const rows = await joins().where(filter).select(...COLS).orderBy('x.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return joins().where('x.id', id).select(...COLS).first(); },
  updateStatus(id, status, remark) {
    return db('payout_banks').where({ id }).update({ status, remark: remark || null, updated_at: db.fn.now() });
  },
  create({ userId, bankName, accountNo, ifscCode, acHolder, passbook, status = 'pending' }) {
    return db('payout_banks').insert({
      user_id: userId, bank_name: bankName, account_no: accountNo, ifsc_code: ifscCode,
      ac_holder: acHolder, passbook: passbook || null, status,
    }).returning('id').then((r) => (typeof r[0] === 'object' ? r[0].id : r[0]));
  },
  update(id, patch) {
    const p = { updated_at: db.fn.now() };
    if (patch.bankName !== undefined) p.bank_name = patch.bankName;
    if (patch.accountNo !== undefined) p.account_no = patch.accountNo;
    if (patch.ifscCode !== undefined) p.ifsc_code = patch.ifscCode;
    if (patch.acHolder !== undefined) p.ac_holder = patch.acHolder;
    if (patch.passbook !== undefined) p.passbook = patch.passbook || null;
    if (patch.userId !== undefined) p.user_id = patch.userId;
    if (patch.status !== undefined) p.status = patch.status;
    if (patch.remark !== undefined) p.remark = patch.remark || null;
    return db('payout_banks').where({ id }).update(p);
  },
};
