'use strict';

/**
 * Support Ticketing menu rows — admin "Support Tickets" (all tickets) +
 * retailer "Support Ticket" (raise/track own tickets). Idempotent.
 */
exports.seed = async function seed(knex) {
  const adminExists = await knex('menu_items').where({ route: '/support-tickets', scope: 'admin' }).first();
  if (!adminExists) {
    await knex('menu_items').insert({
      title: 'Support Tickets', icon: 'ticket', route: '/support-tickets',
      sort_order: 16, is_active: true, scope: 'admin',
    });
  }

  const retailerExists = await knex('menu_items').where({ route: '/support-ticket', scope: 'retailer' }).first();
  if (!retailerExists) {
    await knex('menu_items').insert({
      title: 'Support Ticket', icon: 'ticket', route: '/support-ticket',
      sort_order: 12, is_active: true, scope: 'retailer',
    });
  }
};
