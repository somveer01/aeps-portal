import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import { api } from '../api/client';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
function fmtDateTime(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// kind: 'gst' | 'tds' — same ledger, different tax columns.
export default function TaxReportScreen({ kind = 'gst' }) {
  const isGst = kind === 'gst';
  const title = isGst ? 'GST Report' : 'TDS Report';
  const taxLabel = isGst ? 'GST' : 'TDS';

  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]); const [services, setServices] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', service: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try {
      const fn = isGst ? api.reports.gstReport : api.reports.tdsReport;
      const res = await fn({ ...applied, page: p, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, isGst]);

  useEffect(() => {
    load(1);
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100 }).then((r) => setServices(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, [kind]);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const userOptions = [{ label: 'All', value: '' }, ...users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }))];
  const svcOptions = [{ label: 'All', value: '' }, ...services.map((s) => ({ label: s.title, value: s.title }))];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} Records Found — {title}</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date *"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date *"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="User Type *"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="-- Choose --" /></Fld>
          <Fld label="User Id"><Select value={ff.userId} options={userOptions} onChange={(v) => set('userId', v)} placeholder="-- Choose --" /></Fld>
          <Fld label="Service"><Select value={ff.service} options={svcOptions} onChange={(v) => set('service', v)} placeholder="All" /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 1720, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.cNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.cSvc, styles.thText]}>Service Name</Text>
              <Text style={[styles.cell, styles.cType, styles.thText]}>Type</Text>
              <Text style={[styles.cell, styles.cVal, styles.thText]}>Type Value</Text>
              <Text style={[styles.cell, styles.cVal, styles.thText]}>Type Value in Amount</Text>
              <Text style={[styles.cell, styles.cPct, styles.thText]}>{taxLabel} %</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>{taxLabel} Amt</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Net Amount</Text>
              <Text style={[styles.cell, styles.cWtt, styles.thText]}>Wallet Txn Type</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Wallet Txn Amount</Text>
              <Text style={[styles.cell, styles.cRemark, styles.thText]}>Remark</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Before Bal</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Updated Bal</Text>
              <Text style={[styles.cell, styles.cUser, styles.thText]}>Retailer</Text>
              <Text style={[styles.cell, styles.cDate, styles.thText]}>Date</Text>
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No records found.</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.cNo, styles.td]}>{from + i}</Text>
                    <Text style={[styles.cell, styles.cSvc, styles.td]}>{r.service_name}</Text>
                    <Text style={[styles.cell, styles.cType, styles.td]}>{r.slot_type === 'amount' ? 'By Amount' : 'By Percentage'}</Text>
                    <Text style={[styles.cell, styles.cVal, styles.td]}>{r.slot_type === 'amount' ? `Rs ${Number(r.type_value).toFixed(2)}` : `${Number(r.type_value).toFixed(2)} %`}</Text>
                    <Text style={[styles.cell, styles.cVal, styles.td]}>{Number(r.type_value_amount).toFixed(2)}</Text>
                    <Text style={[styles.cell, styles.cPct, styles.td]}>{Number(isGst ? r.gst_percent : r.tds_percent).toFixed(0)}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{Number(isGst ? r.gst_amount : r.tds_amount).toFixed(2)}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{Number(r.net_amount).toFixed(2)}</Text>
                    <Text style={[styles.cell, styles.cWtt, { color: r.wallet_txn_type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13 }]}>{cap(r.wallet_txn_type)}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{Number(r.wallet_txn_amount).toFixed(2)}</Text>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={4}>{r.remark || '—'}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.before_balance)}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.updated_balance)}</Text>
                    <View style={[styles.cell, styles.cUser]}>
                      <Text style={styles.td}>{r.user_name}</Text>
                      <Text style={styles.sub}>{r.user_code} · {r.user_mobile}</Text>
                    </View>
                    <Text style={[styles.cell, styles.cDate, styles.td]}>{fmtDateTime(r.created_at)}</Text>
                  </View>
                ))}
          </View>
        </ScrollView>
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  cNo: { width: 40 }, cSvc: { width: 120 }, cType: { width: 110 }, cVal: { width: 130 }, cPct: { width: 70 }, cAmt: { width: 100 },
  cWtt: { width: 110 }, cRemark: { width: 220 }, cUser: { width: 160 }, cDate: { width: 150 },
});
