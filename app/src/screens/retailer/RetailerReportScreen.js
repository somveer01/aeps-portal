import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, DateField, Select } from '../../components/UI';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { Fld, Pager, reportStyles } from '../AccountHistoryScreen';

const PAGE = 10;
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const dt = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`; };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

const CONFIG = {
  accountHistory: {
    title: 'Transaction History', fetch: (p) => api.retailer.accountHistory(p),
    cols: [
      ['#', (r, i) => i, 40], ['Service', (r) => r.service_name, 150], ['Type', (r) => cap(r.type), 80, (r) => r.type === 'debit' ? colors.danger : colors.success],
      ['Remark', (r) => r.remark || '—', 240], ['Amount', (r) => money(r.amount), 100], ['Before', (r) => money(r.before_balance), 100],
      ['Updated', (r) => money(r.updated_balance), 100], ['Date', (r) => dt(r.created_at), 130],
    ],
  },
  serviceReport: {
    title: 'Service Report', fetch: (p) => api.retailer.serviceReport(p),
    cols: [
      ['#', (r, i) => i, 40], ['Service', (r) => r.service, 150], ['Operator', (r) => r.operator || '—', 140],
      ['Target', (r) => r.target || '—', 130], ['Amount', (r) => money(r.amount), 100], ['Status', (r) => cap(r.status), 90, (r) => r.status === 'failed' ? colors.danger : colors.success],
      ['Reference', (r) => r.reference_id || '—', 150], ['Date', (r) => dt(r.created_at), 130],
    ],
  },
  gst: {
    title: 'GST Report', fetch: (p) => api.retailer.gstReport(p),
    cols: [['#', (r, i) => i, 40], ['Service', (r) => r.service_name, 150], ['Commission', (r) => money(r.type_value_amount), 120], ['GST %', (r) => `${Number(r.gst_percent).toFixed(0)}`, 70], ['GST Amt', (r) => money(r.gst_amount), 100], ['Net', (r) => money(r.net_amount), 100], ['Date', (r) => dt(r.created_at), 130]],
  },
  tds: {
    title: 'TDS Report', fetch: (p) => api.retailer.tdsReport(p),
    cols: [['#', (r, i) => i, 40], ['Service', (r) => r.service_name, 150], ['Commission', (r) => money(r.type_value_amount), 120], ['TDS %', (r) => `${Number(r.tds_percent).toFixed(0)}`, 70], ['TDS Amt', (r) => money(r.tds_amount), 100], ['Net', (r) => money(r.net_amount), 100], ['Date', (r) => dt(r.created_at), 130]],
  },
  commission: {
    title: 'Commission Report', fetch: (p) => api.retailer.commissionReport(p),
    cols: [['#', (r, i) => i, 40], ['Service', (r) => r.service_name, 160], ['Earned From', (r) => (Number(r.level) > 0 ? `${r.source_user_code || '—'} (level ${r.level})` : 'Own transaction'), 170], ['Commission', (r) => money(r.type_value_amount), 120], ['GST', (r) => money(r.gst_amount), 100], ['TDS', (r) => money(r.tds_amount), 100], ['Net Credited', (r) => money(r.net_amount), 120], ['Date', (r) => dt(r.created_at), 130]],
  },
};

export default function RetailerReportScreen({ kind }) {
  const cfg = CONFIG[kind] || CONFIG.accountHistory;
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [ff, setFf] = useState({ startDate: '', endDate: '' }); const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));
  const minW = cfg.cols.reduce((s, c) => s + c[2], 20);

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await cfg.fetch({ ...applied, page: p, pageSize: PAGE }); setRows(res.rows); setTotal(res.total); setPage(res.page || p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, kind]);

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied, kind]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const from = total === 0 ? 0 : (page - 1) * PAGE + 1; const to = Math.min(total, page * PAGE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={reportStyles.heading}>{total} Records — {cfg.title}</Text>
      <Card>
        <View style={reportStyles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <View style={[reportStyles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: minW, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[reportStyles.tr, reportStyles.th]}>
              {cfg.cols.map((c, i) => <Text key={i} style={[reportStyles.cell, reportStyles.thText, { width: c[2] }]}>{c[0]}</Text>)}
            </View>
            {loading ? <View style={reportStyles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={reportStyles.empty}><Text style={{ color: colors.muted }}>No records found.</Text></View>
                : rows.map((r, idx) => (
                  <View key={r.id || idx} style={[reportStyles.tr, idx % 2 ? reportStyles.trAlt : null]}>
                    {cfg.cols.map((c, i) => {
                      const val = c[1](r, from + idx);
                      const color = c[3] ? c[3](r) : colors.text;
                      return <Text key={i} numberOfLines={2} style={[reportStyles.cell, { width: c[2], fontSize: 13, color, fontWeight: c[3] ? '700' : '400' }]}>{String(val)}</Text>;
                    })}
                  </View>
                ))}
          </View>
        </ScrollView>
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}
