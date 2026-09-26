'use strict';

const BANKS = [
  'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Punjab National Bank',
  'Bank of Baroda', 'Canara Bank', 'Union Bank of India', 'Kotak Mahindra Bank', 'IndusInd Bank',
  'Bank of India', 'Central Bank of India', 'Indian Bank', 'Indian Overseas Bank', 'UCO Bank',
  'Yes Bank', 'IDBI Bank', 'Federal Bank', 'RBL Bank', 'Bandhan Bank',
  'Punjab & Sind Bank', 'Bank of Maharashtra', 'Karur Vysya Bank', 'South Indian Bank', 'AU Small Finance Bank',
];

exports.seed = async function seed(knex) {
  const count = await knex('banks').count('id as c').first();
  if (Number(count.c) > 0) { console.log('Banks already seeded — skipping.'); return; } // eslint-disable-line no-console
  await knex('banks').insert(BANKS.map((name) => ({ name })));
  console.log(`Seeded ${BANKS.length} banks.`); // eslint-disable-line no-console
};
