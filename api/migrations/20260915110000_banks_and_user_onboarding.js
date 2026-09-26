'use strict';

/** Banks master (for Company Bank dropdown) + full onboarding fields on users. */
exports.up = async function up(knex) {
  await knex.schema.createTable('banks', (t) => {
    t.increments('id').primary();
    t.string('name', 150).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('company_banks', (t) => {
    t.integer('bank_id').nullable().references('id').inTable('banks').onDelete('SET NULL');
  });

  await knex.schema.alterTable('users', (t) => {
    t.string('father_husband_name', 150).nullable();
    t.date('dob').nullable();
    t.string('pan_number', 20).nullable();
    t.string('aadhar_number', 20).nullable();
    t.string('gender', 10).nullable(); // male|female|other
    t.string('gst_number', 30).nullable();
    t.decimal('min_balance', 14, 2).notNullable().defaultTo(0);
    t.string('address', 255).nullable();
    t.integer('state_id').nullable().references('id').inTable('states').onDelete('SET NULL');
    t.integer('city_id').nullable().references('id').inTable('cities').onDelete('SET NULL');
    t.string('pincode', 10).nullable();
    t.string('merchant_id', 60).nullable();
    t.integer('assigned_employee_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.jsonb('service_access').nullable();  // array of service ids
    t.jsonb('module_access').nullable();   // array of module routes (for employees)
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    ['father_husband_name', 'dob', 'pan_number', 'aadhar_number', 'gender', 'gst_number', 'min_balance',
      'address', 'state_id', 'city_id', 'pincode', 'merchant_id', 'assigned_employee_id',
      'service_access', 'module_access'].forEach((c) => t.dropColumn(c));
  });
  await knex.schema.alterTable('company_banks', (t) => t.dropColumn('bank_id'));
  await knex.schema.dropTableIfExists('banks');
};
