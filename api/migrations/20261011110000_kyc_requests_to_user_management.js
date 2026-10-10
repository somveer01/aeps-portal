'use strict';

/**
 * Admin left-menu: "KYC Requests" moves from "Verification & KYC" to "User Management" (it is part of onboarding a user: the
 * admin reviews the KYC the user submitted). Only the menu row's parent changes - same route, same screen. Scope pinned to 'admin';
 * safe to run twice.
 */
const SCOPE = 'admin';
const ROUTE = '/kyc-requests';

const topGroup = (knex, title) => knex('menu_items').where({ scope: SCOPE, title }).whereNull('parent_id').first('id');

exports.up = async function up(knex) {
  const to = await topGroup(knex, 'User Management');
  if (!to) return; // a database without that group keeps the old place
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).update({ parent_id: to.id, sort_order: 3 });
};

exports.down = async function down(knex) {
  const back = await topGroup(knex, 'Verification & KYC');
  if (!back) return;
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).update({ parent_id: back.id, sort_order: 3 });
};
