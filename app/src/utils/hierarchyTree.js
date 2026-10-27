// Hierarchy Tree helpers: turn the flat list from GET /api/hierarchy-tree into a tree, count each user's downline, and filter it.
// Pure functions (no React) so they can be reasoned about and tested on their own.

// rows: [{ id, parentId, userTypeId, ... }], types: [{ id, parentTypeId, depth }] (the User Type Master tree)
//   ->  { roots: [node], byId: Map }, node = { ...row, children, downline, typeDepth, misplaced, misplacedReason }.
// parentId null (or a parent that is not in the list) = a top-level user under the Admin. A cycle in bad data cannot loop.
// misplaced = the user sits under a parent whose type is NOT above the user's own type in User Type Master (a user straight under
// the Admin is always fine). Children are listed by type order (User Type Master depth), then by name.
export function buildTree(rows, types = []) {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const aboveOf = (typeId) => { // the ids of every type above `typeId`
    const out = new Set(); let t = typeById.get(typeId);
    while (t && t.parentTypeId && !out.has(t.parentTypeId)) { out.add(t.parentTypeId); t = typeById.get(t.parentTypeId); }
    return out;
  };
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [], downline: 0, typeDepth: (typeById.get(r.userTypeId) || {}).depth || 1, misplaced: false, misplacedReason: '' }]));
  const roots = [];
  // A user whose parent chain leads back to itself (bad data) is shown at the top instead, so the tree itself never has a loop.
  const inLoop = (n, p) => {
    let a = p;
    for (let steps = 0; a && steps <= byId.size; steps += 1) {
      if (a === n) return true;
      a = a.parentId != null ? byId.get(a.parentId) : null;
    }
    return false;
  };
  byId.forEach((n) => {
    const p = n.parentId != null ? byId.get(n.parentId) : null;
    if (p && p !== n && !inLoop(n, p)) p.children.push(n); else roots.push(n);
  });
  if (types.length) {
    byId.forEach((n) => {
      const p = n.parentId != null ? byId.get(n.parentId) : null;
      if (p && p !== n && !aboveOf(n.userTypeId).has(p.userTypeId)) {
        n.misplaced = true;
        n.misplacedReason = `Sits under a ${p.userType || 'user'} (${p.userCode}), which is not above a ${n.userType || 'user'} in User Type Master`;
      }
    });
  }
  const order = (a, b) => a.typeDepth - b.typeDepth || String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase());
  byId.forEach((n) => n.children.sort(order));
  roots.sort(order);
  // Count the downline of every node (iterative post-order; a node reached twice through a cycle is counted once).
  const seen = new Set();
  const count = (node) => {
    const stack = [[node, false]];
    while (stack.length) {
      const [n, done] = stack.pop();
      if (done) { n.downline = n.children.reduce((s, c) => s + 1 + c.downline, 0); continue; }
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      stack.push([n, true]);
      n.children.forEach((c) => stack.push([c, false]));
    }
  };
  roots.forEach(count);
  // Anything that was left out (a closed loop with no top-level user) is shown at the top so no user disappears.
  byId.forEach((n) => { if (!seen.has(n.id)) { roots.push(n); count(n); } });
  return { roots, byId };
}

// Does one node match the screen's filters? (text matches user ID, name or mobile; typeId / status are exact)
export function nodeMatches(n, { text = '', typeId = '', status = '' }) {
  if (status === 'misplaced' && !n.misplaced) return false;
  const t = String(text || '').trim().toLowerCase();
  if (t && !`${n.userCode || ''} ${n.name || ''} ${n.mobile || ''}`.toLowerCase().includes(t)) return false;
  if (typeId !== '' && typeId != null && String(n.userTypeId) !== String(typeId)) return false;
  if (status === 'active' && !n.isActive) return false;
  if (status === 'blocked' && n.isActive) return false;
  return true;
}

// With a filter on: the ids of the users that match and of all their parents (so the path stays visible), and the ids of the
// parents that must be opened to show a match. Returns null when no filter is set (show everything).
export function filterTree(roots, filters) {
  const on = String(filters.text || '').trim() !== '' || (filters.typeId !== '' && filters.typeId != null) || !!filters.status;
  if (!on) return null;
  const visible = new Set(); const matches = new Set(); const open = new Set();
  const walk = (n, trail) => {
    const stack = [[n, trail]];
    while (stack.length) {
      const [x, path] = stack.pop();
      if (nodeMatches(x, filters)) {
        matches.add(x.id); visible.add(x.id);
        path.forEach((p) => { visible.add(p); open.add(p); });
      }
      x.children.forEach((c) => stack.push([c, [...path, x.id]]));
    }
  };
  roots.forEach((r) => walk(r, []));
  return { visible, matches, open };
}

// Number of users per type name, for the summary line.
export function countByType(rows) {
  const out = {};
  rows.forEach((r) => { const k = r.userType || '—'; out[k] = (out[k] || 0) + 1; });
  return out;
}
