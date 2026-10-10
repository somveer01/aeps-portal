import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField, StatusBadge } from '../components/UI';
import UserPicker from '../components/UserPicker';
import { api } from '../api/client';
import DataGrid, { gridParams } from '../components/DataGrid';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';
import { fmtDateTime } from '../utils/dateTime';

const PAGE_SIZE = 10;
const STATUS_OPTIONS = [{ label: 'All', value: '' }, { label: 'Success', value: 'success' }, { label: 'Failed', value: 'failed' }, { label: 'Pending', value: 'pending' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const statusTone = (s) => (s === 'success' ? 'success' : s === 'failed' ? 'danger' : 'warning');

// network: distributor / MD panel — only the caller's own downline.
export default function ServiceReportScreen({ network = false }) {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]); const [services, setServices] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', service: '', status: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));
  const [sort, setSort] = useState(null); const [colFilters, setColFilters] = useState({}); // DataGrid

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await (network ? api.network.serviceReport : api.reports.serviceReport)({ ...applied, ...gridParams(sort, colFilters), page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, sort, colFilters]);

  useEffect(() => {
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
    if (network) api.retailer.catalogue().then((r) => setServices([...r.b2b, ...r.online].map((t) => ({ title: t.title })))).catch(() => {});
    else api.services.list({ pageSize: 100, active: true }).then((r) => setServices(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied, sort, colFilters]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const userOptions = [{ label: 'All', value: '' }, ...users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }))];
  const svcOptions = [{ label: 'All', value: '' }, ...services.map((s) => ({ label: s.title, value: s.title }))];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} Records Found — Service Report</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="User Type"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="All" /></Fld>
          <Fld label="User Id"><UserPicker mode={network ? 'network' : 'admin'} scope="downline" value={ff.userId} onChange={(v) => set('userId', v)} placeholder="All users" /></Fld>
          <Fld label="Service"><Select value={ff.service} options={svcOptions} onChange={(v) => set('service', v)} placeholder="All" /></Fld>
          <Fld label="Status"><Select value={ff.status} options={STATUS_OPTIONS} onChange={(v) => set('status', v)} searchable={false} /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading}
          sort={sort} onSort={setSort} filters={colFilters} onFilter={setColFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'service', title: 'Service', width: 140 },
            { key: 'operator', title: 'Operator', width: 130 },
            { key: 'target', title: 'Mobile / Account', width: 150 },
            { key: 'amount', title: 'Amount', width: 110, render: (r) => <Text style={styles.td}>{money(r.amount)}</Text> },
            { key: 'reference_id', title: 'Reference Id', width: 150 },
            { key: 'status', title: 'Status', width: 120, render: (r) => <StatusBadge label={r.status} tone={statusTone(r.status)} /> },
            { key: 'response', title: 'Response', flex: 1, minWidth: 200, render: (r) => <Text style={styles.td} numberOfLines={2}>{r.response || '—'}</Text> },
            { key: 'user', title: 'User', width: 170, render: (r) => <View><Text style={styles.td}>{r.user_name}</Text><Text style={styles.sub}>{r.user_code}</Text></View> },
            { key: 'created_at', title: 'Date', width: 175, render: (r) => <Text style={styles.td}>{fmtDateTime(r.created_at)}</Text> },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  cNo: { width: 40 }, cSvc: { width: 130 }, cOp: { width: 100 }, cTarget: { width: 140 }, cAmt: { width: 90 }, cRef: { width: 120 }, cStatus: { width: 115 }, cResp: { flex: 1, minWidth: 160 }, cUser: { width: 140 }, cDate: { width: 150 },
});
