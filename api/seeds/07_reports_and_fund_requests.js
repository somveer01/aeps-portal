'use strict';

/** Sample data for Account History, Service Report, Fund Requests. Idempotent. */
exports.seed = async function seed(knex) {
  const users = await knex('users').whereNotNull('user_type_id').select('id', 'full_name', 'mobile', 'user_code').orderBy('id').limit(3);
  if (users.length === 0) { console.log('No managed users — skipping report seed.'); return; } // eslint-disable-line no-console
  const u = users[0];
  const bank = await knex('company_banks').first('id');

  const acctCount = await knex('account_transactions').count('id as c').first();
  if (Number(acctCount.c) === 0) {
    await knex('account_transactions').insert([
      { user_id: u.id, service_name: 'Mobile Recharge', type: 'debit', remark: 'Recharge of Mobile no 9000000111', amount: 10, before_balance: 1000, updated_balance: 990 },
      { user_id: u.id, service_name: 'Mobile Recharge', type: 'credit', remark: 'Commission for Mobile Recharge (0.475 by SELF)', amount: 0.48, before_balance: 990, updated_balance: 990.48 },
      { user_id: u.id, service_name: 'AEPS', type: 'credit', remark: 'AEPS cash withdrawal settlement', amount: 500, before_balance: 990.48, updated_balance: 1490.48 },
      { user_id: u.id, service_name: 'DMT', type: 'debit', remark: 'Money transfer to a/c 3456xxxx', amount: 2000, before_balance: 1490.48, updated_balance: -509.52 },
    ]);
    console.log('Seeded account transactions.'); // eslint-disable-line no-console
  }

  const svcCount = await knex('service_transactions').count('id as c').first();
  if (Number(svcCount.c) === 0) {
    await knex('service_transactions').insert([
      { user_id: u.id, service: 'Mobile Recharge', operator: 'Airtel', target: '9000000111', amount: 10, reference_id: 'REF10012', status: 'success', response: 'Recharge Successful' },
      { user_id: u.id, service: 'DTH Recharge', operator: 'Tata Play', target: '3001234567', amount: 300, reference_id: 'REF10013', status: 'success', response: 'Recharge Successful' },
      { user_id: u.id, service: 'Mobile Recharge', operator: 'Jio', target: '9876543210', amount: 239, reference_id: 'REF10014', status: 'failed', response: 'Operator declined' },
    ]);
    console.log('Seeded service transactions.'); // eslint-disable-line no-console
  }

  const frCount = await knex('fund_requests').count('id as c').first();
  if (Number(frCount.c) === 0) {
    const now = Date.now();
    await knex('fund_requests').insert([
      { user_id: u.id, company_bank_id: bank && bank.id, deposit_date: '2026-09-14', payment_mode: 'NEFT', amount: 5000, request_id: `FR${now}1`, receipt_no: 'RC1001', status: 'pending', remark: 'Fund add request' },
      { user_id: (users[1] || u).id, company_bank_id: bank && bank.id, deposit_date: '2026-09-15', payment_mode: 'IMPS', amount: 2500, request_id: `FR${now}2`, receipt_no: 'RC1002', status: 'pending', remark: 'Please approve' },
    ]);
    console.log('Seeded fund requests.'); // eslint-disable-line no-console
  }
};
