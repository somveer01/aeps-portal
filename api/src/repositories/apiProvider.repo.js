'use strict';

const db = require('../config/db');
const { applyGridFilters, applyGridSortFirst, STATUS_COL, DATE_COL } = require('../utils/gridQuery');
const secretBox = require('../utils/secretBox');

/**
 * API Configuration rows (api_providers). Tokens are stored encrypted; what leaves this file is the
 * masked hint only ("••••1234") plus flags, never the token or the callback secret.
 */
const TABLE = 'api_providers';
const GRID = {
  name: 'p.name', code: 'p.code', adapter: 'p.adapter', base_url: 'p.base_url', username: 'p.username',
  status: STATUS_COL('p.is_active'), updated_at: DATE_COL('p.updated_at'),
};

// Safe view of a row for screens.
function view(r) {
  if (!r) return r;
  return {
    id: r.id, name: r.name, code: r.code, adapter: r.adapter, base_url: r.base_url, username: r.username,
    token_masked: secretBox.mask(r.secret_hint), has_token: !!r.secret_enc, has_callback_secret: !!r.callback_secret_enc,
    has_password: !!r.password_enc, // only "a password is saved": no hint of the password itself
    description: r.description, is_active: r.is_active, updated_at: r.updated_at, created_at: r.created_at,
    services_routed: r.services_routed !== undefined ? Number(r.services_routed) : undefined,
    sp_keys: r.sp_keys !== undefined ? Number(r.sp_keys) : undefined,
    txn_count: r.txn_count !== undefined ? Number(r.txn_count) : undefined,
  };
}

const counts = () => [
  db.raw('(select count(*) from service_routes sr where sr.provider_id = p.id) as services_routed'),
  db.raw("(select count(*) from provider_products pp where pp.provider_id = p.id and pp.is_active and coalesce(pp.sp_key, '') <> '') as sp_keys"),
  db.raw('(select count(*) from service_transactions st where st.provider_id = p.id) as txn_count'),
];

module.exports = {
  GRID,
  view,
  async list({ q = '', page = 1, pageSize = 10, grid = null } = {}) {
    const base = db(`${TABLE} as p`);
    if (q) base.where((w) => w.whereILike('p.name', `%${q}%`).orWhereILike('p.code', `%${q}%`).orWhereILike('p.base_url', `%${q}%`).orWhereILike('p.username', `%${q}%`));
    applyGridFilters(base, grid);
    const countRow = await base.clone().count('p.id as c').first();
    const rows = await base.clone().select('p.*', ...counts())
      .modify((qb) => applyGridSortFirst(qb, grid)).orderBy('p.id', 'asc').limit(pageSize).offset((page - 1) * pageSize);
    return { rows: rows.map(view), total: Number(countRow.c) };
  },
  async options() {
    return db(TABLE).orderBy('id').select('id', 'name', 'code', 'adapter', 'is_active');
  },
  findById(id) { return db(TABLE).where({ id }).first(); },
  async findView(id) { return view(await db(`${TABLE} as p`).where('p.id', id).first('p.*', ...counts())); },
  findByCode(code) { return db(TABLE).whereRaw('upper(code) = upper(?)', [code]).first('id'); },
  async create(f, by) {
    const [row] = await db(TABLE).insert({
      name: f.name, code: f.code, adapter: f.adapter, base_url: f.baseUrl || null, username: f.username || null,
      secret_enc: secretBox.encrypt(f.token), secret_hint: secretBox.hintOf(f.token), password_enc: secretBox.encrypt(f.password),
      callback_secret_enc: secretBox.encrypt(f.callbackSecret), description: f.description || null,
      is_active: f.isActive !== false, updated_by: by,
    }).returning('id');
    return typeof row === 'object' ? row.id : row;
  },
  // Only the fields given change; an empty token / password / callback secret keeps the saved one.
  async update(id, f, by) {
    const patch = { updated_at: db.fn.now(), updated_by: by };
    if (f.name !== undefined) patch.name = f.name;
    if (f.code !== undefined) patch.code = f.code;
    if (f.adapter !== undefined) patch.adapter = f.adapter;
    if (f.baseUrl !== undefined) patch.base_url = f.baseUrl || null;
    if (f.username !== undefined) patch.username = f.username || null;
    if (f.description !== undefined) patch.description = f.description || null;
    if (f.isActive !== undefined) patch.is_active = !!f.isActive;
    if (f.token) { patch.secret_enc = secretBox.encrypt(f.token); patch.secret_hint = secretBox.hintOf(f.token); }
    if (f.password) patch.password_enc = secretBox.encrypt(f.password);
    if (f.callbackSecret) patch.callback_secret_enc = secretBox.encrypt(f.callbackSecret);
    await db(TABLE).where({ id }).update(patch);
  },
  remove(id) { return db(TABLE).where({ id }).del(); },
};
