import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from '../components/Icon';
import { DateField } from '../components/UI';
import { api } from '../api/client';
import { colors, shadows } from '../theme';

// Admin dashboard of the "Modern" layout: KPI cards, commission in / out / net, success / pending / failed / refund tiles,
// pay in / pay out, a sales chart and the top services for an optional date range (GET /api/admin/dashboard?from&to),
// plus the things that need attention and the latest transactions.
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

function IconTile({ name, color, size = 46 }) {
  return <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Icon name={name} size={size * 0.46} color="#fff" /></View>;
}

function Kpi({ icon, tone, label, value, sub }) {
  return (
    <View style={[styles.card, styles.kpi]}>
      <IconTile name={icon} color={tone} />
      <Text style={styles.kLabel}>{label}</Text>
      <Text style={styles.kValue}>{value}</Text>
      {sub ? <Text style={styles.kSub}>{sub}</Text> : null}
    </View>
  );
}

function StatusTile({ icon, tone, label, amount, count }) {
  return (
    <View style={[styles.card, styles.status]}>
      <View style={[styles.statusDot, { backgroundColor: tone }]}><Icon name={icon} size={20} color="#fff" /></View>
      <Text style={styles.kLabel}>{label}</Text>
      <Text style={styles.statusValue}>{money(amount)}</Text>
      <Text style={styles.kSub}>{count} txns</Text>
    </View>
  );
}

function FlowCard({ icon, tone, label, amount, sub }) {
  return (
    <View style={[styles.card, styles.flow]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.kLabel}>{label}</Text>
        <Text style={styles.flowValue}>{money(amount)}</Text>
        {sub ? <Text style={styles.kSub}>{sub}</Text> : null}
      </View>
      <IconTile name={icon} color={tone} size={46} />
    </View>
  );
}

function SalesChart({ points }) {
  const max = Math.max(1, ...points.map((p) => p.amount));
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <View>
      <View style={styles.chart}>
        {points.map((p) => (
          <View key={p.date} style={styles.chartCol}>
            <View style={[styles.bar, { height: Math.max(3, Math.round((p.amount / max) * 130)), backgroundColor: p.amount ? colors.primary : '#e2e8f0' }]} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {points.map((p, i) => (
          <View key={p.date} style={{ flex: 1, alignItems: 'center' }}>
            {i % every === 0 ? <Text style={styles.axis} numberOfLines={1}>{p.date.slice(5)}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ModernDashboard({ notice, onOpen }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback((rng) => {
    setLoading(true); setError(null);
    api.adminDashboard({ from: rng.from, to: rng.to })
      .then((d) => setData(d)).catch((e) => setError(e.message || 'Could not load the dashboard')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(applied); }, [applied, load]);

  const apply = () => {
    if (from && to && from > to) { setError('The start date is after the end date.'); return; }
    setApplied({ from, to });
  };
  const clear = () => { setFrom(''); setTo(''); setApplied({ from: '', to: '' }); };

  const g = data && data.range; const d = data;
  const rangeLabel = applied.from || applied.to ? `${applied.from || 'start'}  →  ${applied.to || 'today'}` : 'All time';

  return (
    <View style={{ gap: 18 }}>
      {notice}
      <View style={styles.titleRow}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={styles.h1}>Dashboard Overview</Text>
          <Text style={styles.sub}>Track your wallets, transactions, and performance.</Text>
        </View>
        <View style={[styles.card, styles.filter]}>
          <Icon name="calendar" size={18} color={colors.primary} />
          <View style={styles.dateBox}><DateField value={from} onChange={setFrom} placeholder="Start Date" /></View>
          <Text style={{ color: '#94a3b8' }}>-</Text>
          <View style={styles.dateBox}><DateField value={to} onChange={setTo} placeholder="End Date" /></View>
          <Pressable onPress={apply} style={[styles.filterBtn, { backgroundColor: colors.primary }]}><Icon name="filter" size={15} color={colors.onPrimary} /><Text style={[styles.filterText, { color: colors.onPrimary }]}>Filter</Text></Pressable>
          {applied.from || applied.to ? <Pressable onPress={clear} hitSlop={6}><Text style={styles.clear}>Clear</Text></Pressable> : null}
        </View>
      </View>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      <View style={styles.row}>
        <Kpi icon="wallet" tone="#2563eb" label="ADMIN WALLET" value={money(d && d.adminWallet)} sub="Available balance" />
        <Kpi icon="cart" tone="#0d9488" label="SALES" value={money(g && g.salesTotal)} sub={`Successful · ${rangeLabel}`} />
        <Kpi icon="users" tone="#d97706" label="TOTAL USERS" value={String(d ? d.users.total : 0)} sub={d ? `${d.users.active} active · ${d.users.inactive} inactive` : ' '} />
        <Kpi icon="cash" tone="#16a34a" label="USERS' WALLET BALANCE" value={money(d && d.users.walletTotal)} sub="Aggregate balance" />
      </View>

      <View style={styles.row}>
        <View style={[styles.card, styles.commission]}>
          <Text style={styles.panelTitle}>Commission</Text>
          <View style={styles.cLine}><Text style={styles.cKey}>Commission IN</Text><Text style={[styles.cVal, { color: '#16a34a' }]}>{money(g && g.commission.in)}</Text></View>
          <View style={styles.cLine}><Text style={styles.cKey}>Commission OUT</Text><Text style={[styles.cVal, { color: '#dc2626' }]}>{money(g && g.commission.out)}</Text></View>
          <View style={[styles.cLine, { borderBottomWidth: 0, paddingTop: 14 }]}><Text style={[styles.cKey, { fontWeight: '800', color: '#0f172a' }]}>Net Profit</Text><Text style={[styles.cVal, { color: colors.primary, fontSize: 20 }]}>{money(g && g.commission.net)}</Text></View>
        </View>
        <View style={styles.statusGrid}>
          <StatusTile icon="check" tone="#16a34a" label="SUCCESS" amount={g && g.statusBreakdown.success.amount} count={g ? g.statusBreakdown.success.count : 0} />
          <StatusTile icon="clock" tone="#d97706" label="PENDING" amount={g && g.statusBreakdown.pending.amount} count={g ? g.statusBreakdown.pending.count : 0} />
          <StatusTile icon="xcircle" tone="#dc2626" label="FAILED" amount={g && g.statusBreakdown.failed.amount} count={g ? g.statusBreakdown.failed.count : 0} />
          <StatusTile icon="refresh" tone="#2563eb" label="REFUND" amount={g && g.statusBreakdown.refund.amount} count={g ? g.statusBreakdown.refund.count : 0} />
        </View>
      </View>

      <View style={styles.row}>
        <FlowCard icon="arrowDown" tone="#16a34a" label="TOTAL PAY IN" amount={g && g.payIn.amount} sub={`${g ? g.payIn.count : 0} approved fund requests`} />
        <FlowCard icon="arrowUp" tone="#dc2626" label="TOTAL PAY OUT" amount={g && g.payOut.amount} sub={`${g ? g.payOut.count : 0} bank transfers`} />
      </View>

      <View style={styles.row}>
        <View style={[styles.card, styles.wide]}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>Sales Trend</Text>
            <View style={styles.badge}><Icon name="trend" size={13} color="#16a34a" /><Text style={styles.badgeText}>Success Sales</Text></View>
          </View>
          {g ? <SalesChart points={g.salesTrend} /> : <ActivityIndicator color={colors.primary} />}
        </View>
        <View style={[styles.card, styles.narrow]}>
          <Text style={styles.panelTitle}>Top Services</Text>
          {g && g.topServices.length === 0 ? <Text style={styles.sub}>No successful transactions in this range.</Text> : null}
          {(g ? g.topServices : []).map((s, i) => {
            const top = g.topServices[0].amount || 1;
            return (
              <View key={s.service} style={{ gap: 5, marginTop: 12 }}>
                <View style={styles.cLine2}><Text style={styles.cKey} numberOfLines={1}>{i + 1}. {s.service}</Text><Text style={styles.rowVal}>{money(s.amount)}</Text></View>
                <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(4, Math.round((s.amount / top) * 100))}%`, backgroundColor: colors.primary }]} /></View>
                <Text style={styles.kSub}>{s.count} txns</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.card, styles.wide]}>
          <Text style={styles.panelTitle}>Recent Transactions</Text>
          {(d ? d.recent : []).map((r) => (
            <View key={r.id} style={styles.cLine2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cKey}>{r.service}</Text>
                <Text style={styles.kSub}>{r.user_name} · {r.user_code}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.rowVal}>{money(r.amount)}</Text>
                <Text style={[styles.kSub, { color: r.status === 'success' ? '#16a34a' : r.status === 'pending' ? '#d97706' : '#dc2626', textTransform: 'capitalize' }]}>{r.status}</Text>
              </View>
            </View>
          ))}
          {d && d.recent.length === 0 ? <Text style={styles.sub}>No transactions yet.</Text> : null}
        </View>
        <View style={[styles.card, styles.narrow]}>
          <Text style={styles.panelTitle}>Needs attention</Text>
          {[
            ['Fund Requests', d && d.actions.fundRequests, { title: 'Fund Requests', route: '/fund-requests' }],
            ['KYC Requests', d && d.actions.kyc, { title: 'KYC Requests', route: '/kyc-requests' }],
            ['Pending Transactions', d && d.actions.pendingTxns, { title: 'Pending Transactions', route: '/pending-transactions' }],
            ['Support Tickets', d && d.actions.tickets, { title: 'Support Tickets', route: '/support-tickets' }],
          ].map(([label, count, item]) => (
            <Pressable key={label} onPress={() => onOpen(item)} style={({ hovered }) => [styles.action, hovered && { backgroundColor: '#f8fafc' }]}>
              <Text style={styles.cKey}>{label}</Text>
              <View style={[styles.count, { backgroundColor: count ? rgba('#d97706', 0.16) : '#f1f5f9' }]}><Text style={{ fontWeight: '800', fontSize: 12.5, color: count ? '#b45309' : '#64748b' }}>{count || 0}</Text></View>
            </Pressable>
          ))}
        </View>
      </View>
      {loading && !data ? <ActivityIndicator color={colors.primary} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
