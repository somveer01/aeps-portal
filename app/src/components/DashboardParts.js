import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import { DateField } from './UI';
import { colors, shadows } from '../theme';

// Building blocks of the "Modern" dashboards (admin: ModernDashboard, distributor / super distributor / retailer: ModernRetailerDashboard):
// KPI card, success / pending / failed / refund tile, pay in / out card, the sales bar chart, the date-range filter and the shared styles.
export const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
export const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

export function IconTile({ name, color, size = 46 }) {
  return <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Icon name={name} size={size * 0.46} color="#fff" /></View>;
}

export function Kpi({ icon, tone, label, value, sub }) {
  return (
    <View style={[ds.card, ds.kpi]}>
      <IconTile name={icon} color={tone} />
      <Text style={ds.kLabel}>{label}</Text>
      <Text style={ds.kValue}>{value}</Text>
      {sub ? <Text style={ds.kSub}>{sub}</Text> : null}
    </View>
  );
}

export function StatusTile({ icon, tone, label, amount, count }) {
  return (
    <View style={[ds.card, ds.status]}>
      <View style={[ds.statusDot, { backgroundColor: tone }]}><Icon name={icon} size={20} color="#fff" /></View>
      <Text style={ds.kLabel}>{label}</Text>
      <Text style={ds.statusValue}>{money(amount)}</Text>
      <Text style={ds.kSub}>{count} txns</Text>
    </View>
  );
}

export function FlowCard({ icon, tone, label, amount, sub }) {
  return (
    <View style={[ds.card, ds.flow]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={ds.kLabel}>{label}</Text>
        <Text style={ds.flowValue}>{money(amount)}</Text>
        {sub ? <Text style={ds.kSub}>{sub}</Text> : null}
      </View>
      <IconTile name={icon} color={tone} size={46} />
    </View>
  );
}

export function SalesChart({ points }) {
  const max = Math.max(1, ...points.map((p) => p.amount));
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <View>
      <View style={ds.chart}>
        {points.map((p) => (
          <View key={p.date} style={ds.chartCol}>
            <View style={[ds.bar, { height: Math.max(3, Math.round((p.amount / max) * 130)), backgroundColor: p.amount ? colors.primary : '#e2e8f0' }]} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {points.map((p, i) => (
          <View key={p.date} style={{ flex: 1, alignItems: 'center' }}>
            {i % every === 0 ? <Text style={ds.axis} numberOfLines={1}>{p.date.slice(5)}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// Top services as bars (each relative to the best one).
export function TopServices({ rows }) {
  return (
    <View>
      {rows && rows.length === 0 ? <Text style={ds.sub}>No successful transactions in this range.</Text> : null}
      {(rows || []).map((s, i) => {
        const top = rows[0].amount || 1;
        return (
          <View key={s.service} style={{ gap: 5, marginTop: 12 }}>
            <View style={ds.cLine2}><Text style={ds.cKey} numberOfLines={1}>{i + 1}. {s.service}</Text><Text style={ds.rowVal}>{money(s.amount)}</Text></View>
            <View style={ds.track}><View style={[ds.fill, { width: `${Math.max(4, Math.round((s.amount / top) * 100))}%`, backgroundColor: colors.primary }]} /></View>
            <Text style={ds.kSub}>{s.count} txns</Text>
          </View>
        );
      })}
    </View>
  );
}

// Start / End date + Filter / Clear. `onApply({from, to})` runs on Filter and on Clear; it returns an error text or nothing.
export function RangeFilter({ applied, onApply }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [msg, setMsg] = useState(null);
  const apply = () => {
    if (from && to && from > to) { setMsg('The start date is after the end date.'); return; }
    setMsg(null); onApply({ from, to });
  };
  const clear = () => { setFrom(''); setTo(''); setMsg(null); onApply({ from: '', to: '' }); };
  return (
    <View>
      <View style={[ds.card, ds.filter]}>
        <Icon name="calendar" size={18} color={colors.primary} />
        <View style={ds.dateBox}><DateField value={from} onChange={setFrom} placeholder="Start Date" /></View>
        <Text style={{ color: '#94a3b8' }}>-</Text>
        <View style={ds.dateBox}><DateField value={to} onChange={setTo} placeholder="End Date" /></View>
        <Pressable onPress={apply} style={[ds.filterBtn, { backgroundColor: colors.primary }]}><Icon name="filter" size={15} color={colors.onPrimary} /><Text style={[ds.filterText, { color: colors.onPrimary }]}>Filter</Text></Pressable>
        {applied.from || applied.to ? <Pressable onPress={clear} hitSlop={6}><Text style={ds.clear}>Clear</Text></Pressable> : null}
      </View>
      {msg ? <Text style={{ color: colors.danger, marginTop: 6 }}>{msg}</Text> : null}
    </View>
  );
}

export const rangeLabel = (applied) => (applied.from || applied.to ? `${applied.from || 'start'}  →  ${applied.to || 'today'}` : 'All time');

export const ds = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#eef2f7', padding: 18, ...shadows.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  h1: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  sub: { color: '#64748b', fontSize: 13.5, marginTop: 2 },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, flexWrap: 'wrap' },
  dateBox: { width: 150 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: 10 },
  filterText: { fontWeight: '800', fontSize: 13.5 },
  clear: { color: '#64748b', fontWeight: '700', fontSize: 13 },
  kpi: { flexGrow: 1, flexBasis: 200, gap: 6 },
  kLabel: { color: '#64748b', fontSize: 11.5, fontWeight: '700', letterSpacing: 0.8, marginTop: 6 },
  kValue: { color: '#0f172a', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  kSub: { color: '#94a3b8', fontSize: 12 },
  commission: { flexGrow: 2, flexBasis: 300, justifyContent: 'center' },
  panelTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 6 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  cLine2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  cKey: { color: '#334155', fontSize: 14.5, flexShrink: 1 },
  cVal: { fontSize: 16, fontWeight: '800' },
  rowVal: { color: '#0f172a', fontWeight: '800', fontSize: 14 },
  statusGrid: { flexGrow: 3, flexBasis: 420, flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  status: { flexGrow: 1, flexBasis: 150, alignItems: 'center', gap: 4, paddingVertical: 20 },
  statusDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  statusValue: { color: '#0f172a', fontSize: 22, fontWeight: '800' },
  flow: { flexGrow: 1, flexBasis: 300, flexDirection: 'row', alignItems: 'center', gap: 12 },
  flowValue: { color: '#0f172a', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  wide: { flexGrow: 2, flexBasis: 420 },
  narrow: { flexGrow: 1, flexBasis: 280 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { color: '#16a34a', fontWeight: '700', fontSize: 12 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 150, gap: 3, marginTop: 14 },
  chartCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { color: '#94a3b8', fontSize: 10.5, marginTop: 4 },
  track: { height: 7, borderRadius: 4, backgroundColor: '#eef2f7', overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 8, borderRadius: 10 },
  count: { minWidth: 30, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
