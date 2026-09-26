'use strict';

/** Seeds plans + commission slots (from the reference recording). Idempotent. */
exports.seed = async function seed(knex) {
  const utRows = await knex('user_types').select('id', 'name');
  const ut = (name) => (utRows.find((r) => r.name.toLowerCase() === name.toLowerCase()) || {}).id;

  // ── Plans ─────────────────────────────────────────────────────
  const planCount = await knex('plans').count('id as c').first();
  if (Number(planCount.c) === 0) {
    await knex('plans').insert([
      { user_type_id: ut('Retailer'), name: 'Retailer Plan' },
      { user_type_id: ut('Retailer'), name: 'Retailer Gold' },
      { user_type_id: ut('Distributor'), name: 'Distributor Plan' },
      { user_type_id: ut('Super Distributor'), name: 'Super Distributor Basic' },
    ].filter((p) => p.user_type_id));
    // eslint-disable-next-line no-console
    console.log('Seeded plans.');
  } else {
    // eslint-disable-next-line no-console
    console.log('Plans already seeded — skipping.');
  }

  // ── Commission slots ─────────────────────────────────────────
  const csCount = await knex('commission_slots').count('id as c').first();
  if (Number(csCount.c) > 0) {
    // eslint-disable-next-line no-console
    console.log('Commission slots already seeded — skipping.');
    return;
  }

  const svcRows = await knex('services').select('id', 'title');
  const svc = (t) => (svcRows.find((r) => r.title.toLowerCase() === t.toLowerCase()) || {}).id;
  const planRows = await knex('plans').select('id', 'name');
  const plan = (n) => (planRows.find((r) => r.name.toLowerCase() === n.toLowerCase()) || {}).id;

  const slots = [
    { userType: 'Retailer', service: 'Money Transfer', operator: null, commission_type: 'percentage', min_amount: 1, max_amount: 10000, value: 2.0, plan: 'Retailer Gold', chain_type: 'self' },
    { userType: 'Distributor', service: 'Mobile Recharge', operator: 'Airtel', commission_type: 'percentage', min_amount: 1, max_amount: 1000, value: 4.0, plan: 'Distributor Plan', chain_type: 'chain' },
    { userType: 'Retailer', service: 'AEPS', operator: null, commission_type: 'percentage', min_amount: 1, max_amount: 1000, value: 5.0, plan: 'Retailer Plan', chain_type: 'chain' },
    { userType: 'Distributor', service: 'AEPS', operator: null, commission_type: 'percentage', min_amount: 1, max_amount: 1000, value: 3.0, plan: 'Distributor Plan', chain_type: 'chain' },
    { userType: 'Retailer', service: 'Aadhar Pay', operator: null, commission_type: 'percentage', min_amount: 1, max_amount: 1000, value: 5.0, plan: 'Retailer Plan', chain_type: 'self' },
    { userType: 'Retailer', service: 'Money Transfer', operator: null, commission_type: 'amount', min_amount: 1, max_amount: 1000, value: 5.0, plan: 'Retailer Plan', chain_type: 'self' },
    { userType: 'Retailer', service: 'Move To Bank', operator: 'IMPS', commission_type: 'amount', min_amount: 1, max_amount: 10000, value: 6.0, plan: 'Retailer Plan', chain_type: 'self' },
  ];

  const rows = slots.map((s) => ({
    user_type_id: ut(s.userType), service_id: svc(s.service), plan_id: plan(s.plan),
    operator: s.operator, commission_type: s.commission_type,
    min_amount: s.min_amount, max_amount: s.max_amount, value: s.value, chain_type: s.chain_type,
  })).filter((r) => r.user_type_id && r.service_id && r.plan_id);

  if (rows.length) await knex('commission_slots').insert(rows);
  // eslint-disable-next-line no-console
  console.log(`Seeded ${rows.length} commission slots.`);
};
