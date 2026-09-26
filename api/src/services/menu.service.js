'use strict';

const menuRepo = require('../repositories/menu.repo');

/**
 * Load active menu items and assemble them into a nested tree
 * (parent -> children), ordered by sort_order. Rendered by the sidebar
 * partial. Because it reads straight from the DB, admins change the menu
 * by editing menu_items rows — no code change needed.
 */
async function getMenuTree(scopes = ['admin', 'both']) {
  const rows = await menuRepo.findAllActive(scopes);

  const byId = new Map();
  rows.forEach((row) => byId.set(row.id, { ...row, children: [] }));

  const roots = [];
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

module.exports = { getMenuTree };
