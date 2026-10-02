'use strict';

// DataGrid column sort + filter on the list endpoints: whole result, whitelisted columns only.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startServer, api, adminUser, signFor } = require('./helper');
const { parseGrid } = require('../src/utils/gridQuery');

const PORT = 3940;
const BASE = `http://localhost:${PORT}`;
const TAG = `grd${Date.now()}`;
let server; let A; const userIds = [];

before(async () => {
  server = await startServer(PORT);
  A = api(BASE, signFor(await adminUser()));
  const ut = await db('user_types').orderBy('id').first('id');
  for (const [i, name] of ['Zeta', 'Alpha', 'Mike'].entries()) {
    // eslint-disable-next-line no-await-in-loop
    const [u] = await db('users').insert({
      username: `${TAG}${i}`, user_code: `${TAG}${i}`, password_hash: 'x', mobile: `900000010${i}`, full_name: `${TAG} ${name}`, role: 'user',
      user_type_id: ut.id, wallet_balance: (i + 1) * 100, kyc_status: 'verified',
    }).returning('id');
    userIds.push(typeof u === 'object' ? u.id : u);
  }
  await db('account_transactions').insert(userIds.map((id, i) => ({ user_id: id, service_name: `${TAG} svc`, type: i ? 'credit' : 'debit', amount: [30, 10, 20][i], before_balance: 0, updated_balance: 0, remark: `${TAG} r${i}` })));
});

after(async () => {
  await db('account_transactions').whereIn('user_id', userIds).del();
  await db('users').whereIn('id', userIds).del();
  server.close();
  await db.destroy();
});

test('parseGrid honours only whitelisted keys and never takes SQL from the request', () => {
  const cols = { name: 'u.full_name', when: { sort: 'x.created_at', filter: 'to_char(x.created_at)' } };
  assert.deepEqual(parseGrid({ sort: 'name', dir: 'ASC' }, cols).sort, { col: 'u.full_name', dir: 'asc' });
  assert.equal(parseGrid({ sort: 'u.id; drop table users', dir: 'asc' }, cols).sort, null);
  assert.equal(parseGrid({ sort: 'name', dir: 'sideways' }, cols).sort.dir, 'desc');
  assert.deepEqual(parseGrid({ f_when: 'Oct', f_evil: 'x', f_name: '  ' }, cols).filters, [{ col: 'to_char(x.created_at)', value: 'Oct' }]);
});

test('Users Manager: column filter + sort over all matching users', async () => {
  const asc = await A.get(`/api/users?f_name=${TAG}&sort=name&dir=asc&pageSize=10`);
  assert.equal(asc.s, 200);
  assert.deepEqual(asc.b.rows.map((r) => r.name), [`${TAG} Alpha`, `${TAG} Mike`, `${TAG} Zeta`]);
  assert.equal(asc.b.total, 3);
  const byWallet = await A.get(`/api/users?f_name=${TAG}&sort=wallet&dir=desc`);
  assert.deepEqual(byWallet.b.rows.map((r) => Number(r.wallet_balance)), [300, 200, 100]);
  const one = await A.get(`/api/users?f_name=${TAG}&f_mobile=9000000101`);
  assert.equal(one.b.total, 1);
  const bad = await A.get(`/api/users?f_name=${TAG}&sort=${encodeURIComponent("1;drop table users")}`);
  assert.equal(bad.s, 200, 'unknown sort key is ignored');
});

test('Account History: sort by amount and filter by type', async () => {
  const r = await A.get(`/api/account-history?f_service_name=${TAG}&sort=amount&dir=asc`);
  assert.equal(r.s, 200);
  assert.deepEqual(r.b.rows.map((x) => Number(x.amount)), [10, 20, 30]);
  const debit = await A.get(`/api/account-history?f_service_name=${TAG}&f_type=debit`);
  assert.equal(debit.b.total, 1);
  const user = await A.get(`/api/account-history?f_user=${TAG}1`);
  assert.equal(user.b.total, 1, 'user column filters on name / code / mobile');
});

test('Service Report and Fund Requests accept grid params', async () => {
  assert.equal((await A.get('/api/service-report?sort=amount&dir=asc&f_status=success')).s, 200);
  assert.equal((await A.get('/api/fund-requests?sort=amount&dir=desc&f_approver=admin')).s, 200);
});
