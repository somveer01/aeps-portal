'use strict';

// Admin profit per transaction is: provider_commission + charges_collected - commission_paid.
// The services shipped with provider_commission_value = 0, so every paid-out commission made
// the admin margin NEGATIVE (which can never happen in real operation — the admin earns a
// gross from the provider and pays the downline chain out of it). This migration sets a
// sensible provider commission on each service and recomputes any historic admin_margins rows
// so the dashboard reflects a correct, non-negative admin margin.
//
// NOTE: Mobile/DTH recharge use a high rate only because the demo commission SLABS pay up to
// ~16.5% on small recharges; real recharge provider commission is ~2-4%. Review those slabs
// in Commission settings if you lower these rates.
const RATES = {
  'mobile recharge': 18.00, 'dth recharge': 18.00,
  'bill payment': 1.50, 'aeps': 0.50, 'aadhar pay': 0.50, 'micro atm': 0.50,
  'money transfer': 1.00, 'move to bank': 1.00, 'fastag recharge': 1.00,
  'lic payment': 1.00, 'gas booking': 1.00, 'load money': 0.50, 'fund request': 0.00,
  'upi collection': 0.50, 'fino cms': 0.50,
  'flight booking': 2.00, 'hotel booking': 2.00, 'bus booking': 2.00,
  'pan card': 3.00, 'merchant ekyc': 2.00, 'bsnl - special tariff': 3.00,
};

exports.up = async function up(knex) {
  // 1) Set provider commission only where it is still unset (idempotent, non-destructive).
  for (const [title, value] of Object.entries(RATES)) {
    // eslint-disable-next-line no-await-in-loop
    await knex('services')
      .whereRaw('lower(title) = ?', [title])
      .andWhere('provider_commission_value', 0)
      .update({ provider_commission_type: 'percentage', provider_commission_value: value });
  }

  // 2) Recompute historic admin_margins with the same formula the code uses.
  await knex.raw(`
    UPDATE admin_margins m SET
      provider_commission = round(CASE WHEN s.provider_commission_type = 'amount'
          THEN s.provider_commission_value ELSE m.amount * s.provider_commission_value / 100 END, 2),
      margin = round((CASE WHEN s.provider_commission_type = 'amount'
          THEN s.provider_commission_value ELSE m.amount * s.provider_commission_value / 100 END)
          + m.charges_collected - m.commission_paid, 2)
    FROM services s
    WHERE lower(s.title) = lower(m.service_name)
      AND m.provider_commission = 0
  `);
};

exports.down = async function down() {
  // One-way data correction; nothing to roll back.
};
