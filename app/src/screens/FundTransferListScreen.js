import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField, StatusBadge } from '../components/UI';
import UserPicker from '../components/UserPicker';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
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

// network: distributor / MD panel — only the caller's own downline.
export default function FundTransferListScreen({ network = false }) {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', transferType: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await (network ? api.network.fundTransfer : api.fundTransfer).list({ ...applied, ...grid.params, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => {
    load(1);
    if (network) {
      // Filter options come from the downline itself (types and users below me).
      api.network.users.list({ pageSize: 100 }).then((r) => {
        setUsers(r.rows);
        const seen = new Map(); r.rows.forEach((u) => seen.set(u.user_type_id, u.user_type_name));
        setUserTypes([...seen].map(([id, name]) => ({ id, name })));
      }).catch(() => {});
    } else {
      api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
      api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    }
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
          <Fld label="User Id"><UserPicker mode={network ? 'network' : 'admin'} scope="downline" value={ff.userId} onChange={(v) => set('userId', v)} placeholder="All users" /></Fld>
          <Fld label="Transfer type"><Select value={ff.transferType} options={TYPE_OPTIONS} onChange={(v) => set('transferType', v)} searchable={false} /></Fld>
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
            { key: 'from', title: 'From User', width: 170, render: (r) => <View><Text style={styles.td}>{r.from_code || 'ADMIN'}</Text><Text style={styles.sub}>{r.from_name || 'Admin'}</Text></View> },
            { key: 'to', title: 'To User', width: 190, render: (r) => <View><Text style={styles.td}>{r.to_code}</Text><Text style={styles.sub}>{r.to_name} · {r.to_outlet || ''}</Text></View> },
            { key: 'amount', title: 'Amount', width: 115, render: (r) => <Text style={styles.td}>{money(r.amount)}</Text> },
            { key: 'transfer_type', title: 'Transfer Type', width: 125, render: (r) => <Text style={{ color: r.transfer_type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{r.transfer_type}</Text> },
            { key: 'remark', title: 'Remark', flex: 1, minWidth: 220, render: (r) => <Text style={styles.td} numberOfLines={2}>{r.remark || '—'}</Text> },
            { key: 'wallet', title: 'Receiver Wallet', width: 170, render: (r) => <View><Text style={styles.sub}>Before {money(r.before_balance)}</Text><Text style={styles.td}>Updated {money(r.updated_balance)}</Text></View> },
            { key: 'status', title: 'Status', width: 115, render: (r) => <StatusBadge label={r.status || 'success'} tone={statusTone(r.status || 'success')} /> },
            { key: 'created_at', title: 'Date', width: 165, render: (r) => <Text style={styles.td}>{fmtDateTime(r.created_at)}</Text> },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  cNo: { width: 40 }, cUser: { width: 170 }, cAmt: { width: 100 }, cType: { width: 110 }, cRemark: { flex: 1, minWidth: 140 }, cWallet: { width: 170 }, cStatus: { width: 115 }, cDate: { width: 150 },
});
