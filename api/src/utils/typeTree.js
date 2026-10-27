'use strict';

/**
 * The User Type Master tree as flat rows with a depth: a type with no parent type = 1, its child types 2, ... (a loop in bad data stops).
 * types = rows of user_types { id, name, parent_type_id }. Returns [{ id, name, parentTypeId, depth }] in the order given.
 * Used wherever a screen / report orders or colours things by type level (Hierarchy Tree, Commission Overview, Admin Margin).
 */
function typeDepths(types) {
  const byId = new Map(types.map((t) => [t.id, t]));
  return types.map((t) => {
    let depth = 1; let p = t.parent_type_id; const seen = new Set([t.id]);
    while (p && byId.has(p) && !seen.has(p)) { seen.add(p); depth += 1; p = byId.get(p).parent_type_id; }
    return { id: t.id, name: t.name, parentTypeId: t.parent_type_id || null, depth };
  });
}

module.exports = { typeDepths };
