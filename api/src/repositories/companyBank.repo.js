'use strict';

const db = require('../config/db');

const TABLE = 'company_banks';

module.exports = {
  async list({ q = '', page = 1, pageSize = 10 } = {}) {
    const base = db(TABLE);
    if (q) base.where((w) => w.whereILike('bank_name', `%${q}%`).orWhereILike('account_holder', `%${q}%`).orWhereILike('account_no', `%${q}%`));
    const countRow = await base.clone().count('id as c').first();
    const rows = await base.clone().select('*').orderBy('id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total: Number(countRow.c) };
  },
  findById(id) { return db(TABLE).where({ id }).first(); },
  create({ bankId, bankName, accountHolder, accountNo, ifscCode, isActive = true }) {
    return db(TABLE).insert({ bank_id: bankId || null, bank_name: bankName, account_holder: accountHolder, account_no: accountNo, ifsc_code: ifscCode, is_active: isActive }).returning('*').then((r) => r[0]);
  },
  update(id, { bankId, bankName, accountHolder, accountNo, ifscCode, isActive }) {
    const patch = { updated_at: db.fn.now() };
    if (bankId !== undefined) patch.bank_id = bankId || null;
    if (bankName !== undefined) patch.bank_name = bankName;
    if (accountHolder !== undefined) patch.account_holder = accountHolder;
    if (accountNo !== undefined) patch.account_no = accountNo;
    if (ifscCode !== undefined) patch.ifsc_code = ifscCode;
    if (isActive !== undefined) patch.is_active = isActive;
    return db(TABLE).where({ id }).update(patch).returning('*').then((r) => r[0]);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
