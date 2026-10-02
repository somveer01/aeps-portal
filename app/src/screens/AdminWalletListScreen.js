import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
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

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.adminWallet.list({ ...applied, ...grid.params, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); setBalance(res.balance); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

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
        <DataGrid
          rows={rows} loading={loading}
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'amount', title: 'Added Amount', width: 125, render: (r) => <Text style={styles.td}>{money(r.amount)}</Text> },
            { key: 'txn_type', title: 'Txn Type', width: 110, render: (r) => <Text style={{ color: r.txn_type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{cap(r.txn_type)}</Text> },
            { key: 'before_balance', title: 'Before Balance', width: 135, render: (r) => <Text style={styles.td}>{money(r.before_balance)}</Text> },
            { key: 'updated_balance', title: 'Updated Balance', width: 135, render: (r) => <Text style={styles.td}>{money(r.updated_balance)}</Text> },
            { key: 'remark', title: 'Remark', flex: 1, minWidth: 220, render: (r) => <Text style={styles.td} numberOfLines={2}>{r.remark || '—'}</Text> },
            { key: 'user', title: 'User', width: 160, render: (r) => <Text style={styles.td}>{r.user_name || r.user_username}</Text> },
            { key: 'created_at', title: 'Created on', width: 165, render: (r) => <Text style={styles.td}>{fmtDateTime(r.created_at)}</Text> },
          ]}
        />
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
