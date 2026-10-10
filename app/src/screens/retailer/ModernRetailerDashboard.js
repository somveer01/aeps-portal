import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Icon from '../../components/Icon';
import { Alert } from '../../components/UI';
import { Kpi, StatusTile, FlowCard, SalesChart, TopServices, RangeFilter, rangeLabel, money, ds as styles } from '../../components/DashboardParts';
import { api } from '../../api/client';
import { colors } from '../../theme';

// Dashboard of the "Modern" layout for Distributor / Super Distributor / Retailer (and employees): the caller's OWN wallet, sales, commission,
// success / pending / failed / refund, pay in / pay out, sales trend and top services for an optional date range
// (GET /api/retailer/dashboard?from&to). A type with a downline also gets a "My Network" band (GET /api/network/summary for the counts).
const QUICK = [
  ['Mobile Recharge', 'phone', '/services/mobile-recharge'], ['AEPS', 'verify', '/services/aeps'],
  ['Money Transfer', 'transfer', '/services/money-transfer'], ['Bill Payment', 'receipt', '/services/bill-payment'],
];

export default function ModernRetailerDashboard({ onOpen }) {
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null); // wallet, KYC, today (not date dependent)
  const [net, setNet] = useState(null); // downline counts / pending fund requests (only types with a downline)
  const [allowed, setAllowed] = useState(null); // routes of services that are on and allowed for me
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback((rng) => {
    setLoading(true); setError(null);
    api.retailer.dashboard({ from: rng.from, to: rng.to })
      .then((d) => setData(d)).catch((e) => setError(e.message || 'Could not load the dashboard')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(applied); }, [applied, load]);
  useEffect(() => {
    api.retailer.summary().then(setSummary).catch(() => {});
    api.retailer.catalogue().then((c) => setAllowed(new Set([...(c.b2b || []), ...(c.online || [])].map((t) => t.route)))).catch(() => setAllowed(new Set()));
    api.network.summary().then(setNet).catch(() => setNet(null)); // a retailer gets 403 -> stays null
  }, []);

  const g = data;
  const quick = QUICK.filter(([, , route]) => allowed && allowed.has(route));
  const hasNet = !!(g && g.network);

  return (
    <View style={{ gap: 18 }}>
      {summary && summary.kycStatus !== 'verified' ? (
        <Alert type="error">{`Your KYC is ${summary.kycStatus || 'pending'}. Services stay locked until your KYC is verified.`}</Alert>
      ) : null}
      <View style={styles.titleRow}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={styles.h1}>Dashboard Overview</Text>
          <Text style={styles.sub}>Your wallet, sales and commission at a glance.</Text>
        </View>
        <RangeFilter applied={applied} onApply={setApplied} />
      </View>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      <View style={styles.row}>
        <Kpi icon="wallet" tone="#2563eb" label="WALLET BALANCE" value={money(summary && summary.balance)} sub="Available balance" />
        <Kpi icon="cart" tone="#0d9488" label="SALES" value={money(g && g.salesTotal)} sub={`Successful · ${rangeLabel(applied)}`} />
        <Kpi icon="report" tone="#7c3aed" label="TODAY'S TRANSACTIONS" value={String(summary ? summary.today.count : 0)} sub={summary ? `${money(summary.today.amount)} wallet movement` : ' '} />
        <Kpi icon="commission" tone="#d97706" label="COMMISSION EARNED" value={money(g && g.commission.total)} sub={`${rangeLabel(applied)} · today ${money(summary && summary.commissionToday)}`} />
      </View>

      {hasNet ? (
        <View style={[styles.card, { gap: 12 }]}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>My Network</Text>
            <View style={styles.badge}><Icon name="users" size={13} color="#16a34a" /><Text style={styles.badgeText}>Downline</Text></View>
          </View>
          <View style={styles.row}>
            <Kpi icon="users" tone="#2563eb" label="DOWNLINE USERS" value={String(g.network.users.total)} sub={`${g.network.users.active} active`} />
            <Kpi icon="trend" tone="#0d9488" label="NETWORK VOLUME" value={money(g.network.volume.amount)} sub={`${g.network.volume.count} successful txns · ${rangeLabel(applied)}`} />
            <Kpi icon="commission" tone="#d97706" label="COMMISSION FROM NETWORK" value={money(g.network.commission)} sub={rangeLabel(applied)} />
            <Kpi icon="wallet" tone="#16a34a" label="DOWNLINE WALLET" value={money(net && net.downline.walletTotal)} sub={net ? `${net.fundRequests.pending} pending fund requests (${money(net.fundRequests.amount)})` : ' '} />
          </View>
        </View>
      ) : null}

      <View style={styles.row}>
        <View style={[styles.card, styles.commission]}>
          <Text style={styles.panelTitle}>Commission</Text>
          <View style={styles.cLine}><Text style={styles.cKey}>From my own business</Text><Text style={[styles.cVal, { color: '#16a34a' }]}>{money(g && g.commission.own)}</Text></View>
          {hasNet ? <View style={styles.cLine}><Text style={styles.cKey}>From my network</Text><Text style={[styles.cVal, { color: '#16a34a' }]}>{money(g && g.commission.network)}</Text></View> : null}
          <View style={[styles.cLine, { borderBottomWidth: 0, paddingTop: 14 }]}><Text style={[styles.cKey, { fontWeight: '800', color: '#0f172a' }]}>Total earned</Text><Text style={[styles.cVal, { color: colors.primary, fontSize: 20 }]}>{money(g && g.commission.total)}</Text></View>
        </View>
        <View style={styles.statusGrid}>
          <StatusTile icon="check" tone="#16a34a" label="SUCCESS" amount={g && g.statusBreakdown.success.amount} count={g ? g.statusBreakdown.success.count : 0} />
          <StatusTile icon="clock" tone="#d97706" label="PENDING" amount={g && g.statusBreakdown.pending.amount} count={g ? g.statusBreakdown.pending.count : 0} />
          <StatusTile icon="xcircle" tone="#dc2626" label="FAILED" amount={g && g.statusBreakdown.failed.amount} count={g ? g.statusBreakdown.failed.count : 0} />
          <StatusTile icon="refresh" tone="#2563eb" label="REFUND" amount={g && g.statusBreakdown.refund.amount} count={g ? g.statusBreakdown.refund.count : 0} />
        </View>
      </View>

      <View style={styles.row}>
        <FlowCard icon="arrowDown" tone="#16a34a" label="MONEY ADDED (PAY IN)" amount={g && g.payIn.amount} sub={`${g ? g.payIn.count : 0} approved fund requests`} />
        <FlowCard icon="arrowUp" tone="#dc2626" label="MONEY SENT (PAY OUT)" amount={g && g.payOut.amount} sub={`${g ? g.payOut.count : 0} bank transfers`} />
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

      {quick.length ? (
        <View style={styles.card}>
          <Text style={styles.panelTitle}>Quick Services</Text>
          <View style={[styles.row, { marginTop: 8 }]}>
            {quick.map(([title, icon, route]) => (
              <Pressable key={route} onPress={() => onOpen(route, title)} style={({ hovered }) => [styles.action, { flexDirection: 'column', gap: 8, width: 130, backgroundColor: hovered ? '#f1f5f9' : '#f8fafc', borderRadius: 14 }]}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} color={colors.onPrimary} /></View>
                <Text style={[styles.cKey, { fontWeight: '700', textAlign: 'center', fontSize: 13 }]}>{title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {loading && !data ? <ActivityIndicator color={colors.primary} /> : null}
    </View>
  );
}
