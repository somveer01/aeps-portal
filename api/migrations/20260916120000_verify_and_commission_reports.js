'use strict';

/**
 * Aadhaar & PAN verification log + Commission Slab / GST / TDS reporting.
 *
 * - `commission_slots.txn_type`  : credit|debit shown as the "Type" column on the
 *                                  read-only Commission Slab screen.
 * - `commission_ledger`          : per-transaction commission breakdown with GST + TDS
 *                                  deductions; backs both the GST Report and TDS Report.
 * - `kyc_verifications`          : audit trail of PAN / Aadhaar verification attempts.
 */
exports.up = async function up(knex) {
  const hasTxnType = await knex.schema.hasColumn('commission_slots', 'txn_type');
  if (!hasTxnType) {
    await knex.schema.alterTable('commission_slots', (t) => {
      t.string('txn_type', 10).notNullable().defaultTo('credit'); // credit | debit
    });
  }

  await knex.schema.createTable('commission_ledger', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('service_name', 120).notNullable();
    t.string('slot_type', 20).notNullable().defaultTo('percentage'); // percentage | amount
    t.decimal('type_value', 12, 2).notNullable().defaultTo(0);        // the % or ₹ from the slab
    t.decimal('type_value_amount', 14, 2).notNullable().defaultTo(0); // commission base (before tax)
    t.decimal('gst_percent', 6, 2).notNullable().defaultTo(0);
    t.decimal('gst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('tds_percent', 6, 2).notNullable().defaultTo(0);
    t.decimal('tds_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_amount', 14, 2).notNullable().defaultTo(0);
    t.string('wallet_txn_type', 10).notNullable().defaultTo('credit'); // credit | debit
    t.decimal('wallet_txn_amount', 14, 2).notNullable().defaultTo(0);
    t.text('remark');
    t.decimal('before_balance', 14, 2).notNullable().defaultTo(0);
    t.decimal('updated_balance', 14, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at'], 'idx_comm_ledger_user_date');
  });

  await knex.schema.createTable('kyc_verifications', (t) => {
    t.increments('id').primary();
    t.integer('admin_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('kind', 12).notNullable();       // pan | aadhaar
    t.string('doc_number', 20).notNullable();  // masked before storage
    t.string('name', 150);
    t.string('status', 20).notNullable().defaultTo('pending'); // verified | otp_sent | failed
    t.string('ref_id', 40);
    t.text('remark');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['kind', 'created_at'], 'idx_kyc_kind_date');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kyc_verifications');
  await knex.schema.dropTableIfExists('commission_ledger');
  const hasTxnType = await knex.schema.hasColumn('commission_slots', 'txn_type');
  if (hasTxnType) {
    await knex.schema.alterTable('commission_slots', (t) => { t.dropColumn('txn_type'); });
  }
};
