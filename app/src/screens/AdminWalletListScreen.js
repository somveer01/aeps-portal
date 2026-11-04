import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import { api } from '../api/client';
import DataGrid, { gridParams, useGrid, useGridReload } from '../components/DataGrid';
import StatementBar from '../components/StatementBar';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';
import { fmtDateTime } from '../utils/dateTime';

const PAGE_SIZE = 10;
const TXN_OPTIONS = [{ label: 'All', value: '' }, { label: 'Money In (Credit)', value: 'credit' }, { label: 'Money Out (Debit)', value: 'debit' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;

export default function AdminWalletListScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [balance, setBalance] = useState(null); const [totals, setTotals] = useState(null);
  const [ff, setFf] = useState({ startDate: '', endDate: '', txnType: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.adminWallet.list({ ...applied, ...grid.params, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); setBalance(res.balance); setTotals(res.totals || null); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>Admin Wallet Statement{balance !== null ? ` — Balance ${money(balance)}` : ''}</Text>
      <Card>
        <Text style={styles.filterTitle}>Filter Data</Text>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
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
            { key: 'created_at', title: 'Date', width: 175, render: (r) => <Text style={styles.td}>{fmtDateTime(r.created_at)}</Text> },
            { key: 'txn_id', title: 'Txn Id', width: 135, render: (r) => <Text style={[styles.td, { fontFamily: 'monospace' }]}>{r.txn_id}</Text> },
            { key: 'remark', title: 'Narration', flex: 1, minWidth: 240, render: (r) => <Text style={styles.td} numberOfLines={3}>{r.remark || '—'}</Text> },
            { key: 'money_in', title: 'Money In', width: 125, sortable: false, filterable: false, render: (r) => <Text style={[styles.td, { color: colors.success, fontWeight: '700' }]}>{r.txn_type === 'credit' ? money(r.amount) : ''}</Text> },
            { key: 'money_out', title: 'Money Out', width: 125, sortable: false, filterable: false, render: (r) => <Text style={[styles.td, { color: colors.danger, fontWeight: '700' }]}>{r.txn_type === 'debit' ? money(r.amount) : ''}</Text> },
            { key: 'updated_balance', title: 'Balance', width: 125, sortable: false, filterable: false, render: (r) => <Text style={[styles.td, { fontWeight: '700' }]}>{money(r.updated_balance)}</Text> },
          ]}
        />
        <StatementBar totals={totals} fetchPage={(p) => api.adminWallet.list(p)} params={{ ...applied, ...gridParams(null, grid.filters) }}
          title="Admin Wallet Statement" filePrefix="admin-wallet-statement" debitLabel="Total money out" creditLabel="Total money in" subtitle="Money in (credit) and money out (debit) of the Admin wallet" />
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
