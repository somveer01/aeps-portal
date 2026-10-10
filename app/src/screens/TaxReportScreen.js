import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import UserPicker from '../components/UserPicker';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';
import { fmtDateTime } from '../utils/dateTime';

const PAGE_SIZE = 10;
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

// kind: 'gst' | 'tds' | 'commission' — same ledger: tax columns, or (commission) every payout with
// its chain level, the downline user it came from, the transaction amount and totals.
export default function TaxReportScreen({ kind = 'gst' }) {
  const isComm = kind === 'commission';
  const isGst = kind === 'gst';
  const title = isComm ? 'Commission Report' : isGst ? 'GST Report' : 'TDS Report';
  const taxLabel = isGst ? 'GST' : 'TDS';
  const [totals, setTotals] = useState(null);

  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]); const [services, setServices] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', service: '', level: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try {
      const fn = isComm ? api.reports.commissionReport : isGst ? api.reports.gstReport : api.reports.tdsReport;
      const res = await fn({ ...applied, ...grid.params, page: p, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page); setTotals(res.totals || null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, isGst, isComm, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => {
    load(1);
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100, active: true }).then((r) => setServices(r.rows)).catch(() => {});
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
          <Fld label="User Id"><UserPicker value={ff.userId} onChange={(v) => set('userId', v)} placeholder="All users" /></Fld>
          <Fld label="Service"><Select value={ff.service} options={svcOptions} onChange={(v) => set('service', v)} placeholder="All" /></Fld>
          {isComm ? <Fld label="Level"><Select value={ff.level} options={LEVEL_OPTIONS} onChange={(v) => set('level', v)} searchable={false} /></Fld> : null}
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
            { key: 'service_name', title: 'Service Name', width: 150 },
            { key: 'slot_type', title: 'Type', width: 130, render: (r) => <Text style={styles.td}>{r.slot_type === 'amount' ? 'By Amount' : 'By Percentage'}</Text> },
            { key: 'type_value', title: 'Type Value', width: 120, render: (r) => <Text style={styles.td}>{r.slot_type === 'amount' ? `Rs ${Number(r.type_value).toFixed(2)}` : `${Number(r.type_value).toFixed(2)} %`}</Text> },
            { key: 'type_value_amount', title: 'Type Value in Amount', width: 150, render: (r) => <Text style={styles.td}>{Number(r.type_value_amount).toFixed(2)}</Text> },
            ...(isComm ? [
              { key: 'gst_amount', title: 'GST Amt', width: 110, render: (r) => <Text style={styles.td}>{Number(r.gst_amount).toFixed(2)}</Text> },
              { key: 'tds_amount', title: 'TDS Amt', width: 110, render: (r) => <Text style={styles.td}>{Number(r.tds_amount).toFixed(2)}</Text> },
            ] : [
              { key: isGst ? 'gst_percent' : 'tds_percent', title: `${taxLabel} %`, width: 100, render: (r) => <Text style={styles.td}>{Number(isGst ? r.gst_percent : r.tds_percent).toFixed(0)}</Text> },
              { key: isGst ? 'gst_amount' : 'tds_amount', title: `${taxLabel} Amt`, width: 110, render: (r) => <Text style={styles.td}>{Number(isGst ? r.gst_amount : r.tds_amount).toFixed(2)}</Text> },
            ]),
            { key: 'net_amount', title: 'Net Amount', width: 120, render: (r) => <Text style={styles.td}>{Number(r.net_amount).toFixed(2)}</Text> },
            { key: 'wallet_txn_type', title: 'Wallet Txn Type', width: 130, render: (r) => <Text style={{ color: r.wallet_txn_type === 'debit' ? colors.danger : colors.success, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>{cap(r.wallet_txn_type)}</Text> },
            { key: 'wallet_txn_amount', title: 'Wallet Txn Amount', width: 140, render: (r) => <Text style={styles.td}>{Number(r.wallet_txn_amount).toFixed(2)}</Text> },
            { key: 'remark', title: 'Remark', flex: 1, minWidth: 220, render: (r) => <Text style={styles.td} numberOfLines={4}>{r.remark || '—'}</Text> },
            { key: 'before_balance', title: 'Before Bal', width: 120, render: (r) => <Text style={styles.td}>{money(r.before_balance)}</Text> },
            { key: 'updated_balance', title: 'Updated Bal', width: 120, render: (r) => <Text style={styles.td}>{money(r.updated_balance)}</Text> },
            { key: 'user', title: 'Earned By', width: 180, render: (r) => <View><Text style={styles.td}>{r.user_name}</Text><Text style={styles.sub}>{`${r.user_code} · ${r.user_mobile}`}</Text></View> },
            { key: 'source', title: 'Earned From', width: 190, render: (r) => <View><Text style={styles.td}>{Number(r.level) > 0 ? `${r.source_user_name || '—'} (${r.source_user_code || '—'})` : 'Own transaction'}</Text>{Number(r.level) > 0 ? <Text style={styles.sub}>Chain level {r.level}{r.source_user_type ? ` · ${r.source_user_type}` : ''}</Text> : null}</View> },
            ...(isComm ? [
              { key: 'level', title: 'Level', width: 80, render: (r) => <Text style={styles.td}>{Number(r.level) > 0 ? `L${r.level}` : 'Own'}</Text> },
              { key: 'txn_amount', title: 'Txn Amount', width: 120, render: (r) => <Text style={styles.td}>{r.txn_amount != null ? money(r.txn_amount) : '—'}</Text> },
              { key: 'operator', title: 'Operator', width: 120, render: (r) => <Text style={styles.td}>{r.txn_operator || r.txn_mode || '—'}</Text> },
            ] : []),
            { key: 'created_at', title: 'Date', width: 175, render: (r) => <Text style={styles.td}>{fmtDateTime(r.created_at)}</Text> },
          ]}
        />
        {isComm && totals ? (
          <View style={styles.totals}>
            <Text style={styles.total}>Paid (net): <Text style={styles.totalVal}>{money(totals.net_credit)}</Text></Text>
            <Text style={styles.total}>Own: <Text style={styles.totalVal}>{money(totals.own)}</Text></Text>
            <Text style={styles.total}>Chain: <Text style={styles.totalVal}>{money(totals.from_downline)}</Text></Text>
            <Text style={styles.total}>Commission: <Text style={styles.totalVal}>{money(totals.commission)}</Text></Text>
            <Text style={styles.total}>GST: <Text style={styles.totalVal}>{money(totals.gst)}</Text></Text>
            <Text style={styles.total}>TDS: <Text style={styles.totalVal}>{money(totals.tds)}</Text></Text>
            <Text style={styles.total}>Charges collected: <Text style={styles.totalVal}>{money(totals.charges)}</Text></Text>
          </View>
        ) : null}
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

const LEVEL_OPTIONS = [{ label: 'All', value: '' }, { label: 'Own transactions', value: 'own' }, { label: 'Chain (any level)', value: 'downline' }, { label: 'Level 1', value: '1' }, { label: 'Level 2', value: '2' }, { label: 'Level 3', value: '3' }];

const styles = StyleSheet.create({
  ...reportStyles,
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 },
  total: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  totalVal: { color: colors.text, fontWeight: '800' },
  cNo: { width: 40 }, cSvc: { width: 120 }, cType: { width: 110 }, cVal: { width: 130 }, cPct: { width: 70 }, cAmt: { width: 100 },
  cWtt: { width: 110 }, cRemark: { width: 220 }, cUser: { width: 160 }, cFrom: { width: 150 }, cDate: { width: 150 },
});
