'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, STATUS_COL } = require('../utils/gridQuery');

// Sortable / filterable grid columns.
const GRID = { bank_name: 'bank_name', account_holder: 'account_holder', account_no: 'account_no', ifsc_code: 'ifsc_code', status: STATUS_COL('is_active') };

const TABLE = 'company_banks';

module.exports = {
  GRID,
  async list({ q = '', page = 1, pageSize = 10, grid = null } = {}) {
    const base = db(TABLE);
    if (q) base.where((w) => w.whereILike('bank_name', `%${q}%`).orWhereILike('account_holder', `%${q}%`).orWhereILike('account_no', `%${q}%`));
    applyGridFilters(base, grid);
    const countRow = await base.clone().count('id as c').first();
    const rows = await base.clone().select('*').modify((qb) => applyGridSortFirst(qb, grid)).orderBy('id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
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
