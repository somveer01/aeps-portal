'use strict';

const bcrypt = require('bcryptjs');

/**
 * Retailer panel seed: role-scoped menu, operators, and a demo retailer login
 * so the panel is demo-able immediately (mock mode, zero credentials).
 * Idempotent.
 */
exports.seed = async function seed(knex) {
  // ── Retailer sidebar (scope='retailer') ───────────────────────────
  const retailerMenu = [
    ['Dashboard', 'grid', '/', 1],
    ['Services', 'services', '/services', 2],
    ['Account History', 'book', '/account-history', 3],
    ['Service Report', 'report', '/service-report', 4],
    ['My Commission Slab', 'commission', '/my-commission-slab', 5],
    ['GST Report', 'report', '/gst-report', 6],
    ['TDS Report', 'report', '/tds-report', 7],
    ['Commission Report', 'report', '/commission-report', 8],
    ['Profile', 'users', '/profile', 9],
    ['KYC', 'verify', '/kyc', 10],
    ['Account Settings', 'settings', '/account-settings', 11],
  ];
  for (const [title, icon, route, sort] of retailerMenu) {
    const exists = await knex('menu_items').where({ route, scope: 'retailer' }).first();
    if (!exists) await knex('menu_items').insert({ title, icon, route, sort_order: sort, is_active: true, scope: 'retailer' });
  }

  // ── Operators (recharge/DTH/BBPS/gas/fastag) ──────────────────────
  const count = await knex('operators').count('id as c').first();
  if (Number(count.c) === 0) {
    const ops = [];
    const push = (service, category, names, circle = false) => names.forEach((name) => ops.push({ service, category, name, circle_required: circle, is_active: true }));
    push('mobile', 'Prepaid', ['Airtel', 'Jio', 'Vi', 'BSNL'], true);
    push('dth', 'DTH', ['Airtel Digital TV', 'Tata Play', 'Dish TV', 'd2h', 'Sun Direct']);
    push('bbps', 'Electricity', ['BSES Yamuna Power Limited', 'BSES Rajdhani Power Limited', 'Tata Power Delhi', 'Adani Electricity Mumbai']);
    push('bbps', 'Insurance', ['LIC of India', 'HDFC Life Insurance', 'ICICI Prudential Life Insurance', 'SBI Life Insurance']);
    push('bbps', 'Water', ['Delhi Jal Board', 'Bangalore Water Supply']);
    push('gas', 'Gas', ['Indane Gas', 'HP Gas', 'Bharat Gas']);
    push('fastag', 'FASTag', ['Airtel Payments Bank FASTag', 'ICICI Bank FASTag', 'Paytm FASTag']);
    await knex('operators').insert(ops);
    // eslint-disable-next-line no-console
    console.log(`Seeded ${ops.length} operators.`);
  }

  // ── Demo retailer login ───────────────────────────────────────────
  const existing = await knex('users').where({ username: 'retailer' }).first();
  if (!existing) {
    // The Retailer type (Service Permissions allow it every service by default); else the first type.
    const userType = await knex('user_types').whereRaw("lower(name) = 'retailer'").first('id') || await knex('user_types').orderBy('id', 'asc').first('id');
    if (userType) {
      const passwordHash = await bcrypt.hash('Retailer@123', 12);
      await knex('users').insert({
        username: 'retailer', user_code: 'retailer', password_hash: passwordHash, role: 'user',
        full_name: 'Demo Retailer', shop_name: 'Demo Banking Point', mobile: '9000000001',
        email: 'retailer@example.com', user_type_id: userType.id, wallet_balance: 5000,
        kyc_status: 'verified', ekyc_status: 'verified', is_active: true,
      });
      // eslint-disable-next-line no-console
      console.log('Seeded demo retailer (retailer / Retailer@123).');
    }
  }
};
