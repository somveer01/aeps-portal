'use strict';

/**
 * Demo commission-ledger rows so the GST Report and TDS Report have data to
 * show, and a little variety in the Commission Slab "Type" column.
 * Idempotent: only seeds when the ledger is empty and a managed user exists.
 */
exports.seed = async function seed(knex) {
  // Give a couple of commission slots a debit type for Commission Slab variety.
  await knex('commission_slots').where({ commission_type: 'amount' }).update({ txn_type: 'debit' });

  const count = await knex('commission_ledger').count('id as c').first();
  if (Number(count.c) > 0) {
    // eslint-disable-next-line no-console
    console.log('Commission ledger already seeded — skipping.');
    return;
  }

  const user = await knex('users').whereNotNull('user_type_id').orderBy('id', 'asc').first('id', 'wallet_balance');
  if (!user) {
    // eslint-disable-next-line no-console
    console.log('No managed user found — skipping commission ledger seed.');
    return;
  }

  // Each row: a commission earned/deducted with GST + TDS applied on the base.
  const samples = [
    { service_name: 'Aadhar Pay', slot_type: 'percentage', type_value: 5.0, type_value_amount: 2.5, gst_percent: 18, tds_percent: 5, wallet_txn_type: 'debit',
      remark: 'Aadhar Pay Cash Withdrawal charge — Service Charge 2.50, GST 0.45, TDS 0.13' },
    { service_name: 'Money Transfer', slot_type: 'percentage', type_value: 2.0, type_value_amount: 20.0, gst_percent: 18, tds_percent: 5, wallet_txn_type: 'credit',
      remark: 'DMT commission — Service Charge 20.00, GST 3.60, TDS 1.00' },
    { service_name: 'Move To Bank', slot_type: 'amount', type_value: 6.0, type_value_amount: 6.0, gst_percent: 18, tds_percent: 5, wallet_txn_type: 'debit',
      remark: 'IMPS payout charge — Service Charge 6.00, GST 1.08, TDS 0.30' },
  ];

  let bal = Number(user.wallet_balance) || 0;
  const rows = samples.map((s) => {
    const gst = +(s.type_value_amount * s.gst_percent / 100).toFixed(2);
    const tds = +(s.type_value_amount * s.tds_percent / 100).toFixed(2);
    const net = +(s.type_value_amount + gst).toFixed(2); // charge shown to user incl. GST
    const before = bal;
    bal = s.wallet_txn_type === 'debit' ? +(bal - net).toFixed(2) : +(bal + s.type_value_amount).toFixed(2);
    return {
      user_id: user.id, service_name: s.service_name, slot_type: s.slot_type,
      type_value: s.type_value, type_value_amount: s.type_value_amount,
      gst_percent: s.gst_percent, gst_amount: gst, tds_percent: s.tds_percent, tds_amount: tds,
      net_amount: net, wallet_txn_type: s.wallet_txn_type, wallet_txn_amount: net,
      remark: s.remark, before_balance: before, updated_balance: bal,
    };
  });

  await knex('commission_ledger').insert(rows);
  // eslint-disable-next-line no-console
  console.log(`Seeded ${rows.length} commission ledger rows for user #${user.id}.`);
};
