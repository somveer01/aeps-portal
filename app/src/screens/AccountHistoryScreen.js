import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;
const TYPE_OPTIONS = [{ label: 'All', value: '' }, { label: 'Credit', value: 'credit' }, { label: 'Debit', value: 'debit' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
function fmtDateTime(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function AccountHistoryScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]); const [services, setServices] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', service: '', type: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.reports.accountHistory({ ...applied, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied]);

  useEffect(() => {
    load(1);
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100, active: true }).then((r) => setServices(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const userOptions = [{ label: 'All', value: '' }, ...users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }))];
  const svcOptions = [{ label: 'All', value: '' }, ...services.map((s) => ({ label: s.title, value: s.title }))];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} Records Found — Transaction History</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="User Type"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="All" /></Fld>
          <Fld label="User Id"><Select value={ff.userId} options={userOptions} onChange={(v) => set('userId', v)} placeholder="All" /></Fld>
          <Fld label="Service"><Select value={ff.service} options={svcOptions} onChange={(v) => set('service', v)} placeholder="All" /></Fld>
          <Fld label="Transaction Type"><Select value={ff.type} options={TYPE_OPTIONS} onChange={(v) => set('type', v)} searchable={false} /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: 1200, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.cNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.cSvc, styles.thText]}>Service Name</Text>
              <Text style={[styles.cell, styles.cType, styles.thText]}>Type</Text>
              <Text style={[styles.cell, styles.cRemark, styles.thText]}>Remark</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Amount</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Before Bal</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Updated Bal</Text>
              <Text style={[styles.cell, styles.cUser, styles.thText]}>Retailer Details</Text>
              <Text style={[styles.cell, styles.cDate, styles.thText]}>Date</Text>
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No transactions found.</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.cNo, styles.td]}>{from + i}</Text>
                    <Text style={[styles.cell, styles.cSvc, styles.td]}>{r.service_name}</Text>
                    <Text style={[styles.cell, styles.cType, { color: r.type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }]}>{r.type}</Text>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={3}>{r.remark || '—'}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.amount)}</Text>
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

export function Fld({ label, children }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>; }
export function Pager({ page, totalPages, from, to, total, onGo }) {
  return (
    <View style={styles.pagination}>
      <Text style={styles.entries}>Showing {from} to {to} of {total} entries</Text>
      <View style={styles.pager}>
        <Pressable disabled={page <= 1} onPress={() => onGo(page - 1)} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Previous</Text></Pressable>
        <View style={[styles.pageBtn, styles.pageCurrent]}><Text style={{ color: '#fff', fontWeight: '700' }}>{page}</Text></View>
        <Pressable disabled={page >= totalPages} onPress={() => onGo(page + 1)} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Next</Text></Pressable>
      </View>
    </View>
  );
}

export const reportStyles = {
  heading: { fontSize: 21, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 14 },
  field: { flexGrow: 1, flexBasis: '22%', minWidth: 180, gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569' },
  input: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  trAlt: { backgroundColor: '#f8fafc' },
  th: { backgroundColor: colors.primary, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  thText: { color: '#fff', fontWeight: '700', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 },
  cell: { paddingVertical: 13, paddingHorizontal: 9 },
  td: { color: colors.text, fontSize: 13 },
  sub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  empty: { padding: 34, alignItems: 'center' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 13, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 }, pageBtnText: { color: colors.text, fontWeight: '600' }, pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
};

const styles = StyleSheet.create({
  ...reportStyles,
  cNo: { width: 40 }, cSvc: { width: 130 }, cType: { width: 80, paddingVertical: 12, paddingHorizontal: 8 }, cRemark: { flex: 1, minWidth: 220 }, cAmt: { width: 100 }, cUser: { width: 170 }, cDate: { width: 150 },
});
