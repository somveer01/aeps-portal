import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import { api } from '../api/client';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const money = (v) => { const n = Number(v || 0); return `${n < 0 ? '-' : ''}₹${Math.abs(n).toFixed(2)}`; };
function fmtDateTime(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const marginColor = (v) => (Number(v) < 0 ? colors.danger : colors.success);

// Admin margin = provider commission + service charges collected − commission paid to users.
export default function AdminMarginScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [services, setServices] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', service: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try {
      const res = await api.reports.adminMargin({ ...applied, page: p, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setTotals(res.totals); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied]);

  useEffect(() => { api.services.list({ pageSize: 100 }).then((r) => setServices(r.rows)).catch(() => {}); }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const svcOptions = [{ label: 'All', value: '' }, ...services.map((s) => ({ label: s.title, value: s.title }))];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} Transactions — Admin Margin</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="Service"><Select value={ff.service} options={svcOptions} onChange={(v) => set('service', v)} placeholder="All" /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <View style={styles.tiles}>
        <Tile label="Provider Commission" value={money(totals?.provider_commission)} />
        <Tile label="Charges Collected" value={money(totals?.charges_collected)} />
        <Tile label="Commission Paid" value={money(totals?.commission_paid)} />
        <Tile label="Admin Margin" value={money(totals?.margin)} color={marginColor(totals?.margin)} strong />
      </View>
      <Text style={styles.note}>Margin = provider commission + service charges collected − commission paid to users and their upline (incl. GST). Set each service's provider commission in Service Master. A red value means that service pays out more than the provider gives.</Text>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 1120, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              {['#', 'Service', 'User', 'Amount', 'Provider Comm.', 'Charges', 'Paid Out', 'Margin', 'Date'].map((h, i) => (
                <Text key={h} numberOfLines={1} style={[styles.cell, styles.thText, { width: COLS[i] }]}>{h}</Text>
              ))}
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No transactions found.</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.td, { width: COLS[0] }]}>{from + i}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[1] }]}>{r.service_name}</Text>
                    <View style={[styles.cell, { width: COLS[2] }]}><Text style={styles.td}>{r.user_name}</Text><Text style={styles.sub}>{r.user_code}</Text></View>
                    <Text style={[styles.cell, styles.td, { width: COLS[3] }]}>{money(r.amount)}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[4] }]}>{money(r.provider_commission)}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[5] }]}>{money(r.charges_collected)}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[6] }]}>{money(r.commission_paid)}</Text>
                    <Text style={[styles.cell, { width: COLS[7], color: marginColor(r.margin), fontWeight: '700', fontSize: 13 }]}>{money(r.margin)}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[8] }]}>{fmtDateTime(r.created_at)}</Text>
                  </View>
                ))}
          </View>
        </ScrollView>
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

const COLS = [40, 150, 170, 110, 130, 110, 110, 120, 160];

function Tile({ label, value, color, strong }) {
  return (
    <Card style={[styles.tile, strong && { borderTopColor: color || colors.primary }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, color ? { color } : null]}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  tile: { flexGrow: 1, flexBasis: 200, minWidth: 180, gap: 6, borderTopWidth: 3, borderTopColor: colors.border },
  tileLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  note: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
});
