import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import { api } from '../api/client';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const TXN_OPTIONS = [{ label: 'All', value: '' }, { label: 'Credit', value: 'credit' }, { label: 'Debit', value: 'debit' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
function fmtDateTime(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function AdminWalletListScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [balance, setBalance] = useState(null);
  const [ff, setFf] = useState({ startDate: '', endDate: '', txnType: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.adminWallet.list({ ...applied, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); setBalance(res.balance); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied]);

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>Wallet Transaction History{balance !== null ? ` — Balance ${money(balance)}` : ''}</Text>
      <Card>
        <Text style={styles.filterTitle}>Filter Data</Text>
        <View style={styles.grid}>
          <Fld label="Start Date *"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date *"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="Transaction Type"><Select value={ff.txnType} options={TXN_OPTIONS} onChange={(v) => set('txnType', v)} searchable={false} /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 1050, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.cNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Added Amount</Text>
              <Text style={[styles.cell, styles.cType, styles.thText]}>Txn Type</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Before Balance</Text>
              <Text style={[styles.cell, styles.cAmt, styles.thText]}>Updated Balance</Text>
              <Text style={[styles.cell, styles.cRemark, styles.thText]}>Remark</Text>
              <Text style={[styles.cell, styles.cUser, styles.thText]}>User</Text>
              <Text style={[styles.cell, styles.cDate, styles.thText]}>Created on</Text>
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No wallet transactions found.</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.cNo, styles.td]}>{from + i}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.amount)}</Text>
                    <Text style={[styles.cell, styles.cType, { color: r.txn_type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13 }]}>{cap(r.txn_type)}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.before_balance)}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.updated_balance)}</Text>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={2}>{r.remark || '—'}</Text>
                    <Text style={[styles.cell, styles.cUser, styles.td]}>{r.user_name || r.user_username}</Text>
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
  filterTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 12 },
  cNo: { width: 40 }, cAmt: { width: 140 }, cType: { width: 90 }, cRemark: { flex: 1, minWidth: 160 }, cUser: { width: 120 }, cDate: { width: 150 },
});
