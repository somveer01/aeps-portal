'use strict';

/** The Hierarchy Tree menu row is called "Users Hierarchy Tree" (clearer: it is the tree of users). Only the menu title changes. */
const SCOPE = 'admin';
const ROUTE = '/hierarchy-tree';

exports.up = async function up(knex) {
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).update({ title: 'Users Hierarchy Tree' });
};

exports.down = async function down(knex) {
  await knex('menu_items').where({ scope: SCOPE, route: ROUTE }).update({ title: 'Hierarchy Tree' });
};
