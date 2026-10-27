import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Card, Alert, Button, Select } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';
import { buildTree, filterTree, countByType } from '../utils/hierarchyTree';
import { copyText } from '../utils/copyText';

const STATUS_OPTIONS = [{ label: 'All status', value: '' }, { label: 'Active', value: 'active' }, { label: 'Blocked', value: 'blocked' }, { label: 'Outside type rules', value: 'misplaced' }];
// Colour of a user type, by its level in User Type Master (1 = the top type): used for the initials circle, the tag and the summary tiles.
const LEVEL_COLORS = [
  { bg: colors.primarySoft, fg: colors.primary },
  { bg: '#dcfce7', fg: '#166534' },
  { bg: '#fef3c7', fg: '#92400e' },
  { bg: '#e0f2fe', fg: '#075985' },
  { bg: '#f1f5f9', fg: '#475569' },
];
const levelColor = (depth) => LEVEL_COLORS[Math.min(Math.max(depth, 1), LEVEL_COLORS.length) - 1];
const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';
const INDENT = 30; // width of one tree level
const COL = { wallet: 140, status: 100, team: 90 }; // right-hand columns, the same on every row so the numbers line up

const TAG_TONES = { danger: { bg: '#fee2e2', fg: '#991b1b' }, warning: { bg: '#fef3c7', fg: '#92400e' }, success: { bg: '#dcfce7', fg: '#166534' } };
// A small rounded label. `tone` = 'danger' | 'warning' | 'success', or a { bg, fg } pair (the user type's colour).
function Tag({ text, tone }) {
  const t = (typeof tone === 'object' ? tone : TAG_TONES[tone]) || { bg: '#f1f5f9', fg: '#475569' };
  return <View style={[st.tag, { backgroundColor: t.bg }]}><Text style={[st.tagText, { color: t.fg }]} numberOfLines={1}>{text}</Text></View>;
}

// Admin: the whole network as a tree (Admin -> Super Distributor -> Distributor -> Retailer). Click the arrow to open / close the users
// below; click a user to open the Users Manager edit form for that user. Search / type / status keep the path to every match visible.
export default function HierarchyTreeScreen({ onOpenUser }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900; // wide: aligned columns on the right; narrow: the details wrap under the name
  const [rows, setRows] = useState([]); const [types, setTypes] = useState([]); const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [text, setText] = useState(''); const [typeId, setTypeId] = useState(''); const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const lastTap = useRef({ id: null, t: 0 }); // double-tap detection (a single tap only selects, a double tap opens the edit form)
  const [copiedId, setCopiedId] = useState(null);

  const tapUser = (n) => {
    const now = Date.now();
    if (lastTap.current.id === n.id && now - lastTap.current.t < 450) { lastTap.current = { id: null, t: 0 }; if (onOpenUser) onOpenUser({ id: n.id, userCode: n.userCode }); return; }
    lastTap.current = { id: n.id, t: now };
  };
  // The user ID is the login username: copy it so it can be pasted into the sign-in screen.
  const copyId = (n) => {
    copyText(n.userCode).then((ok) => { if (!ok) return; setCopiedId(n.id); setTimeout(() => setCopiedId((c) => (c === n.id ? null : c)), 1800); });
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.hierarchy.tree();
      setRows(r.rows || []); setTypes(r.types || []); setTruncated(!!r.truncated);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const { roots, byId } = useMemo(() => buildTree(rows, types), [rows, types]);
  const filters = useMemo(() => ({ text, typeId, status }), [text, typeId, status]);
  const filtered = useMemo(() => filterTree(roots, filters), [roots, filters]);
  const typeOptions = useMemo(() => {
    const seen = new Map(); rows.forEach((r) => seen.set(r.userTypeId, r.userType));
    return [{ label: 'All types', value: '' }, ...[...seen].map(([value, label]) => ({ label: label || '—', value }))];
  }, [rows]);
  const perType = useMemo(() => countByType(rows), [rows]);
  const depthOfType = useMemo(() => Object.fromEntries(types.map((t) => [t.name, t.depth])), [types]);
  const misplacedCount = useMemo(() => [...byId.values()].filter((n) => n.misplaced).length, [byId]);

  // Start with the top-level users open (so their direct users show); a filter opens the path to every match instead.
  useEffect(() => { setExpanded(new Set(filtered ? filtered.open : roots.map((r) => r.id))); /* eslint-disable-next-line */ }, [roots, filtered]);

  const toggle = (id) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expandAll = () => setExpanded(new Set([...byId.values()].filter((n) => n.children.length).map((n) => n.id)));
  const collapseAll = () => setExpanded(new Set());

  // Flatten what is on screen: [{ node, depth }]
  const visibleRows = useMemo(() => {
    const out = [];
    const walk = (nodes, depth) => {
      nodes.forEach((n) => {
        if (filtered && !filtered.visible.has(n.id)) return;
        out.push({ node: n, depth });
        if (n.children.length && expanded.has(n.id)) walk(n.children, depth + 1);
      });
    };
    walk(roots, 1);
    return out;
  }, [roots, expanded, filtered]);

  const filterOn = !!filtered;

  return (
    <View style={{ gap: 16 }}>
      <Card>
        <View style={st.head}>
          <View style={{ flexShrink: 1, flexBasis: 300, flexGrow: 1, gap: 4 }}>
            <Text style={st.title}>Hierarchy Tree</Text>
            <Text style={st.sub}>Who sits under whom. Tap the arrow to open or close a team. Double-click a user to open the edit form. Use Copy to copy a user ID (it is also the login ID).</Text>
          </View>
        </View>

        {/* summary tiles */}
        <View style={st.tiles}>
          <View style={[st.tile, { backgroundColor: colors.primarySoft }]}>
            <Text style={[st.tileNum, { color: colors.primary }]}>{rows.length}</Text><Text style={st.tileLabel}>Total users</Text>
          </View>
          {Object.entries(perType).map(([name, n]) => {
            const c = levelColor(depthOfType[name] || 1);
            return <View key={name} style={[st.tile, { backgroundColor: c.bg }]}><Text style={[st.tileNum, { color: c.fg }]}>{n}</Text><Text style={st.tileLabel}>{name}</Text></View>;
          })}
          {misplacedCount ? (
            <Pressable onPress={() => setStatus(status === 'misplaced' ? '' : 'misplaced')} style={[st.tile, { backgroundColor: '#fee2e2' }]}>
              <Text style={[st.tileNum, { color: '#991b1b' }]}>{misplacedCount}</Text><Text style={st.tileLabel}>Outside type rules</Text>
            </Pressable>
          ) : null}
        </View>

        {/* filters */}
        <View style={st.filters}>
          <View style={st.searchBox}>
            <TextInput value={text} onChangeText={setText} placeholder="Search by user ID, name or mobile" placeholderTextColor={colors.muted} style={st.searchInput} />
            {text ? <Pressable onPress={() => setText('')} hitSlop={10}><Text style={st.clear}>✕</Text></Pressable> : null}
          </View>
          <View style={st.filterSelect}><Select value={typeId} options={typeOptions} onChange={setTypeId} placeholder="All types" searchable={false} /></View>
          <View style={st.filterSelect}><Select value={status} options={STATUS_OPTIONS} onChange={setStatus} placeholder="All status" searchable={false} /></View>
          <View style={st.actions}>
            <Button title="Expand all" variant="ghost" onPress={expandAll} style={st.smallBtn} />
            <Button title="Collapse all" variant="ghost" onPress={collapseAll} style={st.smallBtn} />
            <Button title="Reload" variant="ghost" onPress={load} style={st.smallBtn} />
          </View>
        </View>

        {error ? <Alert type="error">{error}</Alert> : null}
        {truncated ? <Alert type="warning">The network is very large, so only the first 20,000 users are shown.</Alert> : null}

        {loading ? (
          <View style={st.empty}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <View style={st.tree}>
            {/* column titles */}
            {wide ? (
              <View style={st.colHead}>
                <Text style={[st.colTitle, { flex: 1 }]}>USER</Text>
                <Text style={[st.colTitle, { width: COL.wallet, textAlign: 'right' }]}>WALLET</Text>
                <Text style={[st.colTitle, { width: COL.status, textAlign: 'center' }]}>STATUS</Text>
                <Text style={[st.colTitle, { width: COL.team, textAlign: 'center' }]}>TEAM</Text>
              </View>
            ) : null}

            {/* the Admin: the root of the tree */}
            <View style={st.adminRow}>
              <View style={[st.avatar, { backgroundColor: colors.primary }]}><Text style={[st.avatarText, { color: colors.onPrimary }]}>A</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={st.adminName}>Admin</Text>
                <Text style={st.meta}>{filterOn ? `${visibleRows.length} shown` : `${rows.length} users in the network`}</Text>
              </View>
            </View>

            {visibleRows.length === 0 ? <View style={st.empty}><Text style={st.emptyText}>{rows.length ? 'No user matches your search.' : 'No users yet.'}</Text></View> : null}

            {visibleRows.map(({ node: n, depth }) => {
              const isOpen = expanded.has(n.id); const hit = filterOn && filtered.matches.has(n.id);
              const c = levelColor(n.typeDepth);
              const hasKids = n.children.length > 0;
              return (
                <Pressable key={n.id} onPress={() => tapUser(n)}
                  style={({ hovered, pressed }) => [st.row, hit && st.rowHit, (hovered || pressed) && st.rowHover, !n.isActive && { opacity: 0.75 }]}>
                  {/* tree guide lines, one per level */}
                  {Array.from({ length: depth }).map((_, i) => <View key={i} style={st.guide} />)}
                  <View style={st.rowBody}>
                    {hasKids ? (
                      <Pressable onPress={() => toggle(n.id)} hitSlop={8} style={[st.chevron, isOpen && st.chevronOpen]}><Text style={[st.chevronText, isOpen && { color: colors.onPrimary }]}>{isOpen ? '▾' : '▸'}</Text></Pressable>
                    ) : <View style={st.chevronSpace} />}
                    <View style={[st.avatar, { backgroundColor: c.bg }]}><Text style={[st.avatarText, { color: c.fg }]}>{initials(n.name)}</Text></View>
                    <View style={st.nameBlock}>
                      <View style={st.nameLine}>
                        <Text style={st.name} numberOfLines={1}>{n.name}</Text>
                        <Tag text={n.userType || '—'} tone={c} />
                      </View>
                      <View style={st.nameLine}>
                        <Text selectable style={st.code} numberOfLines={1}>{n.userCode}</Text>
                        <Pressable onPress={() => copyId(n)} hitSlop={6} style={[st.copyBtn, copiedId === n.id && st.copyBtnDone]}>
                          <Text style={[st.copyText, copiedId === n.id && { color: '#166534' }]}>{copiedId === n.id ? 'Copied ✓' : 'Copy ID'}</Text>
                        </Pressable>
                        {n.mobile ? <Text style={st.meta} numberOfLines={1}>{n.mobile}</Text> : null}
                      </View>
                      {(n.misplaced || (n.kycStatus && n.kycStatus !== 'verified')) ? (
                        <View style={st.nameLine}>
                          {n.misplaced ? <Tag text="Outside type rules" tone="danger" /> : null}
                          {n.kycStatus && n.kycStatus !== 'verified' ? <Tag text="KYC pending" tone="warning" /> : null}
                        </View>
                      ) : null}
                      {n.misplaced ? <Text style={st.warn}>{n.misplacedReason}</Text> : null}
                    </View>
                    <View style={wide ? st.cols : st.colsNarrow}>
                      <Text style={[st.wallet, wide ? { width: COL.wallet } : null]}>{money(n.walletBalance)}</Text>
                      <View style={wide ? { width: COL.status, alignItems: 'center' } : null}><Tag text={n.isActive ? 'Active' : 'Blocked'} tone={n.isActive ? 'success' : 'danger'} /></View>
                      <View style={wide ? { width: COL.team, alignItems: 'center' } : null}>
                        {n.downline ? <Text style={st.team}>{n.downline} below</Text> : <Text style={st.teamNone}>—</Text>}
                      </View>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </Card>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  sub: { fontSize: 15, lineHeight: 22, color: colors.muted },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  tile: { minWidth: 130, paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.md || 12, gap: 2 },
  tileNum: { fontSize: 28, fontWeight: '800' },
  tileLabel: { fontSize: 14, color: colors.text, fontWeight: '600' },

  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 16 },
  searchBox: { flexGrow: 1, flexBasis: 280, minWidth: 0, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: '#fff', paddingHorizontal: 14, minHeight: 52 },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, outlineStyle: 'none', paddingVertical: 10 },
  clear: { fontSize: 16, color: colors.muted, paddingLeft: 10 },
  filterSelect: { flexBasis: 170, flexGrow: 0, minWidth: 150 },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  smallBtn: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 14 },

  tree: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md || 12, overflow: 'hidden', backgroundColor: '#fff' },
  colHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingLeft: 66, paddingRight: 18, backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: colors.border },
  colTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: colors.muted },
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: colors.primarySoft, borderBottomWidth: 1, borderBottomColor: colors.border },
  adminName: { fontSize: 18, fontWeight: '800', color: colors.text },

  row: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: '#eef2f7', backgroundColor: '#fff', paddingLeft: 18 },
  rowHover: { backgroundColor: '#f8fafc' },
  rowHit: { backgroundColor: '#fff7e6' },
  guide: { width: INDENT, borderLeftWidth: 2, borderLeftColor: '#dbe3ef', marginLeft: 0 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingVertical: 14, paddingRight: 18, minWidth: 0 },

  chevron: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  chevronOpen: { backgroundColor: colors.primary },
  chevronText: { fontSize: 16, color: colors.primary, fontWeight: '800', lineHeight: 18 },
  chevronSpace: { width: 30 },

  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '800' },

  nameBlock: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: 4 },
  nameLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  name: { fontSize: 17, fontWeight: '700', color: colors.text, flexShrink: 1 },
  meta: { fontSize: 14, color: colors.muted },
  code: { fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: 0.3 },
  copyBtn: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f8fafc' },
  copyBtnDone: { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' },
  copyText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  warn: { fontSize: 13, color: colors.danger, lineHeight: 18 },

  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 12.5, fontWeight: '700' },

  cols: { flexDirection: 'row', alignItems: 'center' },
  colsNarrow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, flexBasis: '100%', paddingLeft: 86 },
  wallet: { fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'right' },
  team: { fontSize: 14, fontWeight: '700', color: colors.primary },
  teamNone: { fontSize: 14, color: '#cbd5e1' },

  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 15, color: colors.muted },
});
