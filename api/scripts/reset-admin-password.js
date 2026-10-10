'use strict';

/**
 * Emergency recovery for the ADMIN account (the app cannot reset the admin's own password).
 * Run on the server:
 *   docker compose exec api node scripts/reset-admin-password.js [--username admin]
 * Prints a new random password once. It is never stored in clear text, and passing a password on the
 * command line is not supported (it would stay in the shell history). Every session of the admin is signed out,
 * a failed-login lock is cleared, and the reset is written to audit_log.
 */
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const audit = require('../src/repositories/audit.repo');
const userRepo = require('../src/repositories/user.repo');
const { generatePassword } = require('../src/utils/password');

// Returns { username, password } or throws when there is no such admin.
async function resetAdminPassword(username = '') {
  const q = db('users').where({ role: 'admin' });
  if (username) q.andWhere({ username });
  const admin = await q.orderBy('id').first('id', 'username');
  if (!admin) throw new Error(username ? `No admin account with username "${username}"` : 'No admin account found');
  const password = generatePassword();
  await db.transaction(async (trx) => {
    await userRepo.resetPassword(admin.id, await bcrypt.hash(password, 12), trx);
    await trx('users').where({ id: admin.id }).update({ must_change_password: false }); // the admin picks it via Account Settings
  });
  await audit.log({ userId: admin.id, username: admin.username, event: 'admin_password_reset_script', detail: { targetUserId: admin.id } });
  return { username: admin.username, password };
}

async function main() {
  const i = process.argv.indexOf('--username');
  const username = i > -1 ? String(process.argv[i + 1] || '') : '';
  try {
    const r = await resetAdminPassword(username);
    // eslint-disable-next-line no-console
    console.log(`\nAdmin "${r.username}" password reset.\nNew password (shown once): ${r.password}\nAll admin sessions were signed out. Log in, then change it under Account Settings.\n`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) main();
module.exports = { resetAdminPassword };
