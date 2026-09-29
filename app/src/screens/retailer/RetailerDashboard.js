import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import Icon from '../../components/Icon';
import { Card, Alert } from '../../components/UI';
import { api } from '../../api/client';
import { colors, radius, shadows } from '../../theme';

const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const QUICK = [
  ['Mobile Recharge', 'phone', '/services/mobile-recharge'], ['AEPS', 'verify', '/services/aeps'],
  ['Money Transfer', 'transfer', '/services/money-transfer'], ['Bill Payment', 'receipt', '/services/bill-payment'],
];

export default function RetailerDashboard({ onOpen }) {
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState([]);
  useEffect(() => {
    api.retailer.summary().then(setSummary).catch(() => {});
    api.retailer.serviceStats().then((r) => setStats(r.rows || [])).catch(() => {});
  }, []);

  return (
    <View style={{ gap: 16 }}>
      {summary && summary.kycStatus !== 'verified' ? (
        <Alert type="error">{`Your KYC is ${summary.kycStatus || 'pending'}. Services stay locked until your KYC is verified.`}</Alert>
      ) : null}
      <View style={styles.cards}>
        <Stat label="Wallet Balance" value={money(summary?.balance)} accent={colors.primary} icon="wallet" />
        <Stat label="Today's Transactions" value={String(summary?.today?.count ?? 0)} accent={colors.success} icon="report" />
        <Stat label="Commission Today" value={money(summary?.commissionToday)} accent="#d97706" icon="commission" />
      </View>

      <Card>
        <Text style={styles.section}>Service Statics</Text>
        <ServiceChart rows={stats} />
      </Card>

      <Card>
        <Text style={styles.section}>Quick Services</Text>
        <View style={styles.quick}>
          {QUICK.map(([title, icon, route]) => (
            <Pressable key={route} style={styles.quickTile} onPress={() => onOpen(route, title)}>
              <View style={styles.quickIcon}><Icon name={icon} size={22} color={colors.primary} /></View>
              <Text style={styles.quickLabel}>{title}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
    </View>
  );
}

function Stat({ label, value, accent, icon }) {
  return (
    <Card style={[styles.stat, { borderTopColor: accent }]}>
      <View style={styles.statHead}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={[styles.statIcon, { backgroundColor: `${accent}18` }]}><Icon name={icon} size={18} color={accent} /></View>
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </Card>
  );
}

function ServiceChart({ rows }) {
  if (!rows || rows.length === 0) return <Text style={{ color: colors.muted, paddingVertical: 20 }}>No transactions yet — your service totals will appear here.</Text>;
  const W = 640, H = 220, pad = 30, bw = Math.min(48, (W - pad * 2) / rows.length - 12);
  const max = Math.max(...rows.map((r) => r.amount), 1);
  const palette = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#db2777'];
  return (
    <View style={{ overflow: 'hidden' }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke={colors.border} strokeWidth="1" />
        {rows.slice(0, 10).map((r, i) => {
          const h = Math.round(((H - pad * 2) * r.amount) / max);
          const x = pad + i * ((W - pad * 2) / Math.min(rows.length, 10)) + 6;
          const y = H - pad - h;
          return (
            <React.Fragment key={r.service}>
              <Rect x={x} y={y} width={bw} height={h} rx="4" fill={palette[i % palette.length]} />
              <SvgText x={x + bw / 2} y={H - pad + 14} fontSize="9" fill={colors.muted} textAnchor="middle">{r.service.split(' ')[0]}</SvgText>
              <SvgText x={x + bw / 2} y={y - 4} fontSize="9" fill={colors.text} textAnchor="middle">{Math.round(r.amount)}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  stat: { flexGrow: 1, minWidth: 200, gap: 10, borderTopWidth: 3 },
  statHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  section: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 12 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  quickTile: { width: 120, backgroundColor: colors.primarySoft, borderRadius: radius.md, alignItems: 'center', padding: 14, gap: 8, borderWidth: 1, borderColor: '#dbe6fb' },
  quickIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadows.sm },
  quickLabel: { fontSize: 12.5, fontWeight: '700', color: colors.text, textAlign: 'center' },
});
