'use strict';

/** Sample payout banks for managed users. Idempotent. */
exports.seed = async function seed(knex) {
  const count = await knex('payout_banks').count('id as c').first();
  if (Number(count.c) > 0) { console.log('Payout banks already seeded — skipping.'); return; } // eslint-disable-line no-console
  const users = await knex('users').whereNotNull('user_type_id').select('id').orderBy('id').limit(2);
  if (users.length === 0) return;
  const rows = [
    { user_id: users[0].id, bank_name: 'AXIS BANK', account_no: '100000000001', ifsc_code: 'UTIB0000001', ac_holder: 'Demo Holder One', status: 'approved', remark: 'Verified' },
    { user_id: (users[1] || users[0]).id, bank_name: 'BANK OF BARODA', account_no: '100000000002', ifsc_code: 'BARB0000001', ac_holder: 'Demo Holder Two', status: 'pending' },
  ];
  await knex('payout_banks').insert(rows);
  console.log(`Seeded ${rows.length} payout banks.`); // eslint-disable-line no-console
};
