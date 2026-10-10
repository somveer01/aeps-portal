import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Icon from '../components/Icon';
import { Kpi, StatusTile, FlowCard, SalesChart, TopServices, RangeFilter, rangeLabel, money, rgba, ds as styles } from '../components/DashboardParts';
import { api } from '../api/client';
import { colors } from '../theme';

// Admin dashboard of the "Modern" layout: KPI cards, commission in / out / net, success / pending / failed / refund tiles,
// pay in / pay out, a sales chart and the top services for an optional date range (GET /api/admin/dashboard?from&to),
// plus the things that need attention and the latest transactions. The managed-user panels use ModernRetailerDashboard.
export default function ModernDashboard({ notice, onOpen }) {
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

  const g = data && data.range; const d = data;

  return (
    <View style={{ gap: 18 }}>
      {notice}
      <View style={styles.titleRow}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={styles.h1}>Dashboard Overview</Text>
          <Text style={styles.sub}>Track your wallets, transactions, and performance.</Text>
        </View>
        <RangeFilter applied={applied} onApply={setApplied} />
      </View>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      <View style={styles.row}>
        <Kpi icon="wallet" tone="#2563eb" label="ADMIN WALLET" value={money(d && d.adminWallet)} sub="Available balance" />
        <Kpi icon="cart" tone="#0d9488" label="SALES" value={money(g && g.salesTotal)} sub={`Successful · ${rangeLabel(applied)}`} />
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
          <TopServices rows={g ? g.topServices : null} />
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
