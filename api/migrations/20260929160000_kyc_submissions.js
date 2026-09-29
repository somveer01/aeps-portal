'use strict';

/**
 * KYC documents submitted by managed users (retailer / distributor / MD) and the admin's
 * review. Images live in a private folder (never the public /uploads path); only the
 * last 4 Aadhaar digits are stored. Approving sets users.kyc_status = 'verified'.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('kyc_submissions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.string('aadhaar_last4', 4).notNullable();
    t.string('pan_number', 10).notNullable();
    t.string('bank_name', 120).notNullable();
    t.string('account_holder', 120).notNullable();
    t.string('account_no', 30).notNullable();
    t.string('ifsc_code', 11).notNullable();
    // Private file names (see middleware/upload.js kycUpload).
    t.string('aadhaar_front', 80).notNullable();
    t.string('aadhaar_back', 80).notNullable();
    t.string('pan_card', 80).notNullable();
    t.string('shop_photo', 80).notNullable();
    t.string('selfie', 80).notNullable();
    t.string('bank_proof', 80).nullable(); // cancelled cheque / passbook
    t.text('review_remark');
    t.integer('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status', 'created_at'], 'idx_kyc_sub_status');
    t.index(['user_id'], 'idx_kyc_sub_user');
  });
  // One open submission per user at a time.
  await knex.raw("create unique index uq_kyc_sub_pending on kyc_submissions (user_id) where status = 'pending'");

  if (!(await knex('menu_items').where({ route: '/kyc-requests' }).first())) {
    await knex('menu_items').insert({ parent_id: null, title: 'KYC Requests', icon: 'verify', route: '/kyc-requests', sort_order: 10, scope: 'admin', is_active: true });
  }
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ route: '/kyc-requests' }).del();
  await knex.schema.dropTableIfExists('kyc_submissions');
};
