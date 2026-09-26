import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField, StatusBadge } from '../components/UI';
import { api } from '../api/client';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const TYPE_OPTIONS = [{ label: 'All', value: '' }, { label: 'Credit', value: 'credit' }, { label: 'Debit', value: 'debit' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const statusTone = (s) => (s === 'success' || s === 'approved' ? 'success' : s === 'failed' || s === 'rejected' ? 'danger' : 'warning');
function fmtDateTime(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function FundTransferListScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', transferType: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.fundTransfer.list({ ...applied, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied]);

  useEffect(() => {
    load(1);
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const userOptions = [{ label: 'All', value: '' }, ...users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }))];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} Records Found — Fund Transfer</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="User Type"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="All" /></Fld>
          <Fld label="User Id"><Select value={ff.userId} options={userOptions} onChange={(v) => set('userId', v)} placeholder="All" /></Fld>
          <Fld label="Transfer type"><Select value={ff.transferType} options={TYPE_OPTIONS} onChange={(v) => set('transferType', v)} searchable={false} /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 1370, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.cNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.cUser, styles.thText]}>From User</Text>
              <Text style={[styles.cell, styles.cUser, styles.thText]}>To User</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Amount</Text>
              <Text style={[styles.cell, styles.cType, styles.thText]}>Transfer Type</Text>
              <Text style={[styles.cell, styles.cRemark, styles.thText]}>Remark</Text>
              <Text style={[styles.cell, styles.cWallet, styles.thText]}>Receiver Wallet</Text>
              <Text style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
              <Text style={[styles.cell, styles.cDate, styles.thText]}>Date</Text>
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No transfers found.</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.cNo, styles.td]}>{from + i}</Text>
                    <View style={[styles.cell, styles.cUser]}><Text style={styles.td}>{r.from_code || 'ADMIN'}</Text><Text style={styles.sub}>{r.from_name || 'Admin'}</Text></View>
                    <View style={[styles.cell, styles.cUser]}><Text style={styles.td}>{r.to_code}</Text><Text style={styles.sub}>{r.to_name} · {r.to_outlet || ''}</Text></View>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.amount)}</Text>
                    <Text style={[styles.cell, styles.cType, { color: r.transfer_type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }]}>{r.transfer_type}</Text>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={2}>{r.remark || '—'}</Text>
                    <View style={[styles.cell, styles.cWallet]}>
                      <Text style={styles.sub}>Before {money(r.before_balance)}</Text>
                      <Text style={styles.td}>Updated {money(r.updated_balance)}</Text>
                    </View>
                    <View style={[styles.cell, styles.cStatus]}><StatusBadge label={r.status || 'success'} tone={statusTone(r.status || 'success')} /></View>
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
  cNo: { width: 40 }, cUser: { width: 170 }, cAmt: { width: 100 }, cType: { width: 110 }, cRemark: { flex: 1, minWidth: 140 }, cWallet: { width: 170 }, cStatus: { width: 115 }, cDate: { width: 150 },
});
