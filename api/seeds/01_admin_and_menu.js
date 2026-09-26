'use strict';

const bcrypt = require('bcryptjs');
const env = require('../src/config/env');

/**
 * Seeds the first admin user and a starter menu tree.
 * Idempotent: skips rows that already exist so it is safe to re-run.
 */
exports.seed = async function seed(knex) {
  // ── Admin user ────────────────────────────────────────────────
  const existingAdmin = await knex('users')
    .where({ username: env.seedAdmin.username })
    .first();

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(env.seedAdmin.password, 12);
    await knex('users').insert({
      username: env.seedAdmin.username,
      password_hash: passwordHash,
      full_name: env.seedAdmin.fullName,
      mobile: env.seedAdmin.mobile,
      email: env.seedAdmin.email,
      role: 'admin',
      is_active: true,
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded admin user "${env.seedAdmin.username}".`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`Admin user "${env.seedAdmin.username}" already exists — skipping.`);
  }

  // ── Menu tree ─────────────────────────────────────────────────
  const menuCount = await knex('menu_items').count('id as c').first();
  if (Number(menuCount.c) > 0) {
    // eslint-disable-next-line no-console
    console.log('Menu already seeded — skipping.');
    return;
  }

  // Dashboard (top-level). The Modules group and its screens are managed
  // separately (added as the app grew); AEPS Services was removed as unused.
  await knex('menu_items')
    .insert({ title: 'Dashboard', icon: 'grid', route: '/', sort_order: 1, is_active: true });

  // eslint-disable-next-line no-console
  console.log('Seeded starter menu tree.');
};
