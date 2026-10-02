import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Card, Button, Alert, DateField } from '../../components/UI';
import { api } from '../../api/client';
import DataGrid, { useGrid, useGridReload } from '../../components/DataGrid';
import { colors } from '../../theme';
import { Fld, Pager, reportStyles } from '../AccountHistoryScreen';

const PAGE = 10;
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const dt = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`; };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

// cols: [title, value(row, n), width, colour(row)?, gridKey] — gridKey = the API's sort/filter key; null = not sortable.
const CONFIG = {
  accountHistory: {
    title: 'Transaction History', fetch: (p) => api.retailer.accountHistory(p),
    cols: [
      ['#', (r, i) => i, 56, null, null], ['Service', (r) => r.service_name, 150, null, 'service_name'], ['Type', (r) => cap(r.type), 90, (r) => (r.type === 'debit' ? colors.danger : colors.success), 'type'],
      ['Remark', (r) => r.remark || '—', 240, null, 'remark'], ['Amount', (r) => money(r.amount), 110, null, 'amount'], ['Before', (r) => money(r.before_balance), 110, null, 'before_balance'],
      ['Updated', (r) => money(r.updated_balance), 110, null, 'updated_balance'], ['Date', (r) => dt(r.created_at), 130, null, 'created_at'],
    ],
  },
  serviceReport: {
    title: 'Service Report', fetch: (p) => api.retailer.serviceReport(p),
    cols: [
      ['#', (r, i) => i, 56, null, null], ['Service', (r) => r.service, 150, null, 'service'], ['Operator', (r) => r.operator || '—', 140, null, 'operator'],
      ['Target', (r) => r.target || '—', 130, null, 'target'], ['Amount', (r) => money(r.amount), 110, null, 'amount'], ['Status', (r) => cap(r.status), 100, (r) => (r.status === 'failed' ? colors.danger : colors.success), 'status'],
      ['Reference', (r) => r.reference_id || '—', 150, null, 'reference_id'], ['Date', (r) => dt(r.created_at), 130, null, 'created_at'],
    ],
  },
  gst: {
    title: 'GST Report', fetch: (p) => api.retailer.gstReport(p),
    cols: [['#', (r, i) => i, 56, null, null], ['Service', (r) => r.service_name, 150, null, 'service_name'], ['Commission', (r) => money(r.type_value_amount), 130, null, 'type_value_amount'], ['GST %', (r) => `${Number(r.gst_percent).toFixed(0)}`, 90, null, 'gst_percent'], ['GST Amt', (r) => money(r.gst_amount), 110, null, 'gst_amount'], ['Net', (r) => money(r.net_amount), 110, null, 'net_amount'], ['Date', (r) => dt(r.created_at), 130, null, 'created_at']],
  },
  tds: {
    title: 'TDS Report', fetch: (p) => api.retailer.tdsReport(p),
    cols: [['#', (r, i) => i, 56, null, null], ['Service', (r) => r.service_name, 150, null, 'service_name'], ['Commission', (r) => money(r.type_value_amount), 130, null, 'type_value_amount'], ['TDS %', (r) => `${Number(r.tds_percent).toFixed(0)}`, 90, null, 'tds_percent'], ['TDS Amt', (r) => money(r.tds_amount), 110, null, 'tds_amount'], ['Net', (r) => money(r.net_amount), 110, null, 'net_amount'], ['Date', (r) => dt(r.created_at), 130, null, 'created_at']],
  },
  commission: {
    title: 'Commission Report', fetch: (p) => api.retailer.commissionReport(p),
    cols: [['#', (r, i) => i, 56, null, null], ['Service', (r) => r.service_name, 160, null, 'service_name'], ['Earned From', (r) => (Number(r.level) > 0 ? `${r.source_user_code || '—'} (level ${r.level})` : 'Own transaction'), 180, null, 'source'], ['Commission', (r) => money(r.type_value_amount), 130, null, 'type_value_amount'], ['GST', (r) => money(r.gst_amount), 110, null, 'gst_amount'], ['TDS', (r) => money(r.tds_amount), 110, null, 'tds_amount'], ['Net Credited', (r) => money(r.net_amount), 130, null, 'net_amount'], ['Date', (r) => dt(r.created_at), 130, null, 'created_at']],
  },
};

// RetailerShell mounts this with key={kind}, so switching reports starts with a fresh grid.
export default function RetailerReportScreen({ kind }) {
  const cfg = CONFIG[kind] || CONFIG.accountHistory;
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [ff, setFf] = useState({ startDate: '', endDate: '' }); const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));
  const grid = useGrid(); // DataGrid column sort + filters

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await cfg.fetch({ ...applied, ...grid.params, page: p, pageSize: PAGE }); setRows(res.rows); setTotal(res.total); setPage(res.page || p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
    /* eslint-disable-next-line */
  }, [page, applied, kind, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied, kind]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const from = total === 0 ? 0 : (page - 1) * PAGE + 1; const to = Math.min(total, page * PAGE);
  const columns = cfg.cols.map(([title, value, width, colour, key], i) => ({
    key: key || `c${i}`, title, width, sortable: !!key, filterable: !!key,
    render: (r, idx) => (
      <Text numberOfLines={2} style={{ fontSize: 13, color: colour ? colour(r) : colors.text, fontWeight: colour ? '700' : '400' }}>{String(value(r, from + idx))}</Text>
    ),
  }));

  return (
    <View style={{ gap: 16 }}>
      <Text style={reportStyles.heading}>{total} Records — {cfg.title}</Text>
      <Card>
        <View style={reportStyles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <View style={[reportStyles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid rows={rows} loading={loading} rowKey={(r, i) => r.id || i} columns={columns}
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters} />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}
