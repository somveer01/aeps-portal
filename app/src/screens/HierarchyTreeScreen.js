import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Card, Alert, Button, Select } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';
import { s, Chip } from './api/apiStyles';
import { buildTree, filterTree, countByType } from '../utils/hierarchyTree';

const STATUS_OPTIONS = [{ label: 'All status', value: '' }, { label: 'Active', value: 'active' }, { label: 'Blocked', value: 'blocked' }, { label: 'Outside type rules', value: 'misplaced' }];
const TONES = ['primary', 'success', 'warning', 'muted']; // by the user's type level in User Type Master
const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Admin: the whole network as a tree (Admin -> Super Distributor -> Distributor -> Retailer). Click the arrow to open / close the users
// below; click a user to open the Users Manager edit form for that user. Search / type / status keep the path to every match visible.
export default function HierarchyTreeScreen({ onOpenUser }) {
  const [rows, setRows] = useState([]); const [types, setTypes] = useState([]); const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [text, setText] = useState(''); const [typeId, setTypeId] = useState(''); const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(new Set());

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

  return (
    <View style={{ gap: 16 }}>
      <Card>
        <View style={s.cardHead}>
          <View style={{ flexShrink: 1, flexBasis: 320, flexGrow: 1, gap: 2 }}>
            <Text style={s.cardTitle}>Hierarchy Tree</Text>
            <Text style={s.sub}>Who sits under whom. Click the arrow to open or close the users below; click a user to open the edit form.</Text>
          </View>
          <View style={[s.searchWrap, { flexGrow: 1, justifyContent: 'flex-end', maxWidth: '100%' }]}>
            <View style={{ flexGrow: 1, flexBasis: 150, maxWidth: 200 }}><Select value={typeId} options={typeOptions} onChange={setTypeId} placeholder="All types" searchable={false} /></View>
            <View style={{ flexGrow: 1, flexBasis: 150, maxWidth: 200 }}><Select value={status} options={STATUS_OPTIONS} onChange={setStatus} placeholder="All status" searchable={false} /></View>
            <TextInput value={text} onChangeText={setText} placeholder="Search user ID / name / mobile…" placeholderTextColor={colors.muted}
              style={[s.search, { minHeight: 48, flexGrow: 1, flexBasis: 200, minWidth: 0, maxWidth: 320 }]} />
          </View>
        </View>

        {error ? <Alert type="error">{error}</Alert> : null}
        {truncated ? <Alert type="warning">The network is very large, so only the first 20,000 users are shown.</Alert> : null}

        <View style={st.summary}>
          <Text style={st.summaryText}>{rows.length} user(s)</Text>
          {Object.entries(perType).map(([name, n]) => <Chip key={name} text={`${name}: ${n}`} tone="muted" />)}
          {misplacedCount ? <Chip text={`Outside type rules: ${misplacedCount}`} tone="danger" /> : null}
          <View style={{ flex: 1 }} />
          <Button title="Expand all" variant="ghost" onPress={expandAll} style={st.smallBtn} />
          <Button title="Collapse all" variant="ghost" onPress={collapseAll} style={st.smallBtn} />
          <Button title="Reload" variant="ghost" onPress={load} style={st.smallBtn} />
        </View>

        {loading ? (
          <View style={st.empty}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <View style={st.tree}>
            <View style={st.row}>
              <View style={st.chevronSpace} />
              <Chip text="Admin" tone="primary" />
              <Text style={st.name}>Admin</Text>
              <Text style={st.meta}>{rows.length} user(s) in total</Text>
            </View>
            {visibleRows.length === 0 ? <View style={st.empty}><Text style={{ color: colors.muted }}>{rows.length ? 'No user matches.' : 'No users yet.'}</Text></View> : null}
            {visibleRows.map(({ node: n, depth }) => {
              const isOpen = expanded.has(n.id); const hit = filtered && filtered.matches.has(n.id);
              return (
                <Pressable key={n.id} onPress={() => onOpenUser && onOpenUser({ id: n.id, userCode: n.userCode })} style={[st.row, hit && st.rowHit, !n.isActive && { opacity: 0.7 }]}>
                  <View style={{ width: depth * 22 }} />
                  {n.children.length ? (
                    <Pressable onPress={() => toggle(n.id)} hitSlop={8} style={st.chevron}><Text style={st.chevronText}>{isOpen ? '▼' : '►'}</Text></Pressable>
                  ) : <View style={st.chevronSpace} />}
                  <Chip text={n.userType || '—'} tone={TONES[Math.min(n.typeDepth - 1, TONES.length - 1)]} />
                  <View style={{ flexShrink: 1, flexGrow: 1, flexBasis: 160, gap: 1 }}>
                    <Text style={st.name} numberOfLines={1}>{n.name}</Text>
                    <Text style={st.meta} numberOfLines={1}>{n.userCode}{n.mobile ? ` · ${n.mobile}` : ''}</Text>
                    {n.misplaced ? <Text style={st.warn}>{n.misplacedReason}</Text> : null}
                  </View>
                  <Text style={st.wallet}>{money(n.walletBalance)}</Text>
                  {n.misplaced ? <Chip text="Outside type rules" tone="danger" /> : null}
                  <Chip text={n.isActive ? 'Active' : 'Blocked'} tone={n.isActive ? 'success' : 'danger'} />
                  {n.kycStatus && n.kycStatus !== 'verified' ? <Chip text="KYC pending" tone="warning" /> : null}
                  {n.downline ? <Text style={st.below}>Below: {n.downline}</Text> : null}
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
  summary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  summaryText: { fontWeight: '700', color: colors.text },
  smallBtn: { minHeight: 36, paddingVertical: 6, paddingHorizontal: 12 },
  tree: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: '#fff' },
  rowHit: { backgroundColor: colors.primarySoft },
  chevron: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  chevronText: { color: colors.primary, fontSize: 12 },
  chevronSpace: { width: 22 },
  name: { fontWeight: '700', color: colors.text },
  meta: { color: colors.muted, fontSize: 12 },
  warn: { color: colors.danger, fontSize: 12 },
  wallet: { fontWeight: '700', color: colors.text, minWidth: 100, textAlign: 'right' },
  below: { color: colors.muted, fontSize: 12, minWidth: 70 },
  empty: { padding: 24, alignItems: 'center' },
});
