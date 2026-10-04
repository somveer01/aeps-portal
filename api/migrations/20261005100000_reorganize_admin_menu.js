'use strict';

/**
 * Reorganise the ADMIN left-menu into functional groups.
 *
 * Menus are data-driven (menu_items -> GET /api/menu), so this migration only
 * reshuffles rows: it creates the group containers, re-parents each existing
 * screen under the right group, renames "Retailer Panel" -> "Retailer Master",
 * and removes the now-empty legacy groups. No screen/route is added or removed
 * (every route below already exists and is wired in DashboardScreen).
 *
 * Scope is pinned to 'admin' throughout — several routes (e.g. /account-history,
 * /service-report) also exist for the retailer scope and must not be touched.
 */

const SCOPE = 'admin';

// Group container -> [ [route, sortOrder], ... ]  (routes are unique per screen).
const LAYOUT = [
  { title: 'User Management', icon: 'users', sort: 2, items: [
    ['/modules/user-type-master', 1],
    ['/users-manager', 2],
    ['/modules/service-category', 3],
    ['/modules/service-master', 4],
    ['/modules/service-permissions', 5],
    ['/retailer-panel', 6],
  ] },
  { title: 'Masters & Configuration', icon: 'layers', sort: 3, items: [
    ['/company-banks', 1],
    ['/modules/city-master', 2],
    ['/modules/plan-master', 3],
  ] },
  { title: 'Fund Management', icon: 'fund', sort: 4, items: [
    ['/fund-transfer', 1],
    ['/fund-transfers', 2],
    ['/fund-requests', 3],
    ['/admin-wallet/add', 4],
    ['/admin-wallet/all', 5],
  ] },
  { title: 'Verification & KYC', icon: 'verify', sort: 5, items: [
    ['/pan-verify', 1],
    ['/aadhaar-verify', 2],
    ['/kyc-requests', 3],
  ] },
  { title: 'Transactions & Banking', icon: 'book', sort: 6, items: [
    ['/payout-banks', 1],
    ['/account-history', 2],
    ['/pending-transactions', 3],
    ['/reconciliation', 4],
  ] },
  { title: 'Commission & Margin', icon: 'commission', sort: 7, items: [
    ['/modules/commission-slots', 1],
    ['/commission-slab', 2],
    ['/admin-margin', 3],
  ] },
  { title: 'Reports', icon: 'report', sort: 8, items: [
    ['/service-report', 1],
    ['/gst-report', 2],
    ['/tds-report', 3],
  ] },
  { title: 'Support & Helpdesk', icon: 'ticket', sort: 9, items: [
    ['/support-tickets', 1],
    ['/modules/ticket-departments', 2],
    ['/modules/announcements', 3],
  ] },
  { title: 'Account Settings', icon: 'settings', sort: 10, items: [
    ['/modules/settings', 1],
    ['/modules/application-banners', 2],
    ['/change-password', 3],
    ['/txn-pin', 4],
    ['/logout', 5],
  ] },
];

// Legacy top-level groups (route-less containers) left empty after the reshuffle.
const LEGACY_GROUPS = ['Modules', 'Fund Transfer', 'Aadhar & Pan Verify', 'Admin Wallet'];

exports.up = async function up(knex) {
  // Ensure a route-less group container exists for the admin scope; return its id.
  async function ensureGroup(title, icon, sort) {
    const existing = await knex('menu_items')
      .where({ scope: SCOPE, title })
      .whereNull('parent_id')
      .where((b) => b.whereNull('route').orWhere('route', ''))
      .first('id');
    if (existing) {
      await knex('menu_items').where({ id: existing.id }).update({ icon, sort_order: sort, is_active: true });
      return existing.id;
    }
    const [row] = await knex('menu_items')
      .insert({ parent_id: null, title, icon, route: null, scope: SCOPE, sort_order: sort, is_active: true })
      .returning('id');
    return typeof row === 'object' ? row.id : row;
  }

  // Dashboard stays at the top.
  await knex('menu_items').where({ scope: SCOPE, route: '/' }).update({ sort_order: 1, parent_id: null });

  // Build groups and re-parent their screens.
  for (const g of LAYOUT) {
    const gid = await ensureGroup(g.title, g.icon, g.sort);
    for (const [route, sort] of g.items) {
      await knex('menu_items')
        .where({ scope: SCOPE, route })
        .update({ parent_id: gid, sort_order: sort });
    }
  }

  // "Retailer Panel" -> "Retailer Master".
  await knex('menu_items').where({ scope: SCOPE, route: '/retailer-panel' }).update({ title: 'Retailer Master' });

  // Remove the now-empty legacy group containers (route-less, no remaining children).
  for (const title of LEGACY_GROUPS) {
    const groups = await knex('menu_items')
      .where({ scope: SCOPE, title })
      .whereNull('parent_id')
      .where((b) => b.whereNull('route').orWhere('route', ''))
      .select('id');
    for (const grp of groups) {
      const kids = await knex('menu_items').where({ parent_id: grp.id }).count('* as c').first();
      if (Number(kids.c) === 0) await knex('menu_items').where({ id: grp.id }).del();
    }
  }
};

exports.down = async function down() {
  // Data reshuffle — not reversibly restored. Re-run the admin menu seed to rebuild.
};
