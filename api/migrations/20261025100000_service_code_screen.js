'use strict';

/**
 * Service identity (step 1 of "everything runs from Service Master"):
 *  - services.code    a stable key (e.g. 'mobile-recharge') that never changes when the title is renamed;
 *  - services.screen  which built-in RETAILER screen opens the service ('mobile-recharge', 'aeps', ...; empty = no retailer
 *                     tile). The list of screens is the registry in services/retailerScreens.js;
 *  - service_id       on service_transactions / commission_ledger / admin_margins, so history, limits and margins can follow the
 *                     service by id (the name text stays for display).
 * Existing services get a code (known titles keep their historic key, others a slug of the title) and the built-in screens, and
 * old rows get their service_id from the title (aliases FASTag -> Fastag Recharge, NSDL PAN Card -> PAN Card included).
 * code is nullable (a service inserted without one still resolves by title) and unique when set. Reversible.
 */
const KNOWN = {
  'mobile recharge': ['mobile-recharge', 'mobile-recharge'],
  'dth recharge': ['dth-recharge', 'dth-recharge'],
  'bill payment': ['bill-payment', 'bill-payment'],
  'lic payment': ['lic-payment', 'lic-payment'],
  'gas booking': ['gas-booking', 'gas-booking'],
  'fastag recharge': ['fastag', 'fastag'],
  fastag: ['fastag', 'fastag'],
  'move to bank': ['move-to-bank', 'move-to-bank'],
  aeps: ['aeps', 'aeps'],
  'aadhar pay': ['aadhar-pay', 'aadhar-pay'],
  'micro atm': ['micro-atm', 'micro-atm'],
  'money transfer': ['money-transfer', 'money-transfer'],
  'flight booking': ['flight', 'flight'],
  'hotel booking': ['hotel', 'hotel'],
  'bus booking': ['bus', 'bus'],
  'fund request': ['fund-request', null], // always shown in the sidebar, not a tile
  'upi collection': ['upi-collection', null],
  'fino cms': ['fino-cms', null],
  'pan card': ['nsdl-pan', null],
};
const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'service';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('services', 'code'))) {
    await knex.schema.alterTable('services', (t) => { t.string('code', 60); t.string('screen', 40); });
  }
  for (const table of ['service_transactions', 'commission_ledger', 'admin_margins']) {
    if (!(await knex.schema.hasColumn(table, 'service_id'))) {
      await knex.schema.alterTable(table, (t) => { t.integer('service_id').references('id').inTable('services').onDelete('SET NULL'); t.index('service_id'); });
    }
  }

  // Codes + screens for the services that exist.
  const rows = await knex('services').orderBy('id').select('id', 'title', 'code');
  const used = new Set(rows.filter((r) => r.code).map((r) => r.code));
  for (const r of rows) {
    if (r.code) continue;
    const known = KNOWN[String(r.title).trim().toLowerCase()];
    let code = known ? known[0] : slug(r.title);
    if (used.has(code)) { let n = 2; while (used.has(`${code}-${n}`)) n += 1; code = `${code}-${n}`; }
    used.add(code);
    // eslint-disable-next-line no-await-in-loop
    await knex('services').where({ id: r.id }).update({ code, screen: known ? known[1] : null });
  }
  await knex.raw('create unique index if not exists uq_services_code on services (lower(code)) where code is not null');

  // service_id for old rows, by title (+ the two aliases).
  const fill = (table, col) => knex.raw(
    `update ${table} t set service_id = s.id from services s
      where t.service_id is null
        and (lower(t.${col}) = lower(s.title)
          or (lower(t.${col}) = 'fastag' and lower(s.title) = 'fastag recharge')
          or (lower(t.${col}) = 'nsdl pan card' and lower(s.title) = 'pan card'))`);
  await fill('service_transactions', 'service');
  await fill('commission_ledger', 'service_name');
  await fill('admin_margins', 'service_name');
};

exports.down = async function down(knex) {
  for (const table of ['service_transactions', 'commission_ledger', 'admin_margins']) {
    if (await knex.schema.hasColumn(table, 'service_id')) await knex.schema.alterTable(table, (t) => { t.dropColumn('service_id'); });
  }
  await knex.raw('drop index if exists uq_services_code');
  if (await knex.schema.hasColumn('services', 'code')) await knex.schema.alterTable('services', (t) => { t.dropColumn('code'); t.dropColumn('screen'); });
};
