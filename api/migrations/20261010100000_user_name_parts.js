'use strict';

// A user's name in three parts. users.full_name stays and is kept in sync by the API (every report, search and
// list reads it), so nothing else changes. Existing users are split once: first word = first name, last word =
// last name, anything in between = middle name (a single word is only a first name). full_name is never touched.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('first_name', 80).nullable();
    t.string('middle_name', 80).nullable();
    t.string('last_name', 80).nullable();
  });
  await knex.raw(`
    UPDATE users u SET
      first_name  = p.parts[1],
      last_name   = CASE WHEN cardinality(p.parts) > 1 THEN p.parts[cardinality(p.parts)] END,
      middle_name = CASE WHEN cardinality(p.parts) > 2 THEN array_to_string(p.parts[2:cardinality(p.parts) - 1], ' ') END
    FROM (SELECT id, regexp_split_to_array(btrim(full_name), '\\s+') AS parts FROM users WHERE btrim(coalesce(full_name, '')) <> '') p
    WHERE u.id = p.id AND u.first_name IS NULL
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('first_name');
    t.dropColumn('middle_name');
    t.dropColumn('last_name');
  });
};
