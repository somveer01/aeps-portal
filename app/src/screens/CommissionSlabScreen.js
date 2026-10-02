import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

export default function CommissionSlabScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [services, setServices] = useState([]);
  const [ff, setFf] = useState({ userTypeId: '', serviceId: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.commissionSlab({ ...applied, ...grid.params, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => {
    load(1);
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100, active: true }).then((r) => setServices(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const svcOptions = [{ label: 'All', value: '' }, ...services.map((s) => ({ label: s.title, value: s.id }))];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>Commission Slab</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="User Type *"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="-- Choose --" /></Fld>
          <Fld label="Service"><Select value={ff.serviceId} options={svcOptions} onChange={(v) => set('serviceId', v)} placeholder="All" /></Fld>
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
            { key: 'user_type', title: 'User Type', width: 140, render: (r) => <Text style={styles.td}>{r.user_type_name}</Text> },
            { key: 'service', title: 'Service', width: 170, render: (r) => <View><Text style={styles.td}>{r.service_name}</Text>{r.operator ? <Text style={styles.sub}>{r.operator}</Text> : null}</View> },
            { key: 'commission_type', title: 'Commision Type', width: 140, render: (r) => <Text style={styles.td}>{r.commission_type === 'amount' ? 'By Amount' : 'By Percentage'}</Text> },
            { key: 'range', title: 'Amount Range', width: 170, render: (r) => <Text style={styles.td}>{`Rs ${Number(r.min_amount).toFixed(2)} - ${Number(r.max_amount).toFixed(2)}`}</Text> },
            { key: 'value', title: 'Amount / Percentage', width: 150, render: (r) => <Text style={styles.td}>{r.commission_type === 'amount' ? `Rs ${Number(r.value).toFixed(2)}` : `${Number(r.value).toFixed(2)} %`}</Text> },
            { key: 'plan', title: 'Plan', width: 150, render: (r) => <Text style={styles.td}>{r.plan_name}</Text> },
            { key: 'txn_type', title: 'Type', width: 100, render: (r) => <Text style={{ color: r.txn_type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{cap(r.txn_type)}</Text> },
            { key: 'chain_type', title: 'Chain Type', width: 110, render: (r) => <Text style={styles.td}>{cap(r.chain_type)}</Text> },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  cNo: { width: 40 }, cUt: { width: 110 }, cSvc: { width: 150 }, cCt: { width: 130 }, cRange: { width: 170 }, cVal: { width: 150 }, cPlan: { width: 130 }, cType: { width: 80 }, cChain: { width: 90 },
});
