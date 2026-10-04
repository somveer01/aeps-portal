import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Card, Button, Alert, DateField, Select } from '../../components/UI';
import { api } from '../../api/client';
import DataGrid, { useGrid, useGridReload } from '../../components/DataGrid';
import { colors, radius } from '../../theme';
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
  // Own commission + what came from the whole downline: which downline user, which level, through
  // which of my direct users (Via), the transaction amount, and service charges (Charge) apart.
  commission: {
    title: 'Commission Report', fetch: (p) => api.retailer.commissionReport(p),
    cols: [
      ['#', (r, i) => i, 56, null, null], ['Service', (r) => r.service_name, 150, null, 'service_name'],
      ['Earned From', (r) => (Number(r.level) > 0 ? `${r.source_user_name || '—'} (${r.source_user_code || '—'})${r.source_user_type ? ` · ${r.source_user_type}` : ''}` : 'Own transaction'), 220, null, 'source'],
      ['Level', (r) => (Number(r.level) > 0 ? `L${r.level}` : 'Own'), 80, null, 'level'],
      ['Via', (r) => (r.via_child_code ? `${r.via_child_code} · ${r.via_child_name || ''}` : '—'), 170, null, null],
      ['Txn Amount', (r) => (r.txn_amount != null ? money(r.txn_amount) : '—'), 120, null, 'txn_amount'],
      ['Operator', (r) => r.txn_operator || r.txn_mode || '—', 120, null, 'operator'],
      ['Type', (r) => (r.wallet_txn_type === 'debit' ? 'Charge' : 'Credit'), 90, (r) => (r.wallet_txn_type === 'debit' ? colors.danger : colors.success), 'wallet_txn_type'],
      ['Commission', (r) => money(r.type_value_amount), 120, null, 'type_value_amount'], ['GST', (r) => money(r.gst_amount), 100, null, 'gst_amount'],
      ['TDS', (r) => money(r.tds_amount), 100, null, 'tds_amount'], ['Net', (r) => money(r.net_amount), 120, null, 'net_amount'],
      ['Date', (r) => dt(r.created_at), 120, null, 'created_at'],
    ],
  },
};

// RetailerShell mounts this with key={kind}, so switching reports starts with a fresh grid.
export default function RetailerReportScreen({ kind }) {
  const cfg = CONFIG[kind] || CONFIG.accountHistory;
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const isComm = kind === 'commission';
  const [ff, setFf] = useState({ startDate: '', endDate: '', level: '', type: '', sourceUserId: '', branchChildId: '' }); const [applied, setApplied] = useState({});
  const [totals, setTotals] = useState(null); const [summary, setSummary] = useState(null); const [downline, setDownline] = useState([]);
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));
  const grid = useGrid(); // DataGrid column sort + filters

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await cfg.fetch({ ...applied, ...grid.params, page: p, pageSize: PAGE }); setRows(res.rows); setTotal(res.total); setPage(res.page || p); setTotals(res.totals || null); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
    /* eslint-disable-next-line */
  }, [page, applied, kind, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied, kind]);

  // Commission report: per-direct-user summary for the chosen dates, and my downline for the user filter
  // (a retailer has no downline: the network call answers 403 and those filters stay hidden).
  useEffect(() => {
    if (!isComm) return;
    api.retailer.commissionSummary({ startDate: applied.startDate, endDate: applied.endDate }).then(setSummary).catch(() => setSummary(null));
  }, [isComm, applied.startDate, applied.endDate]);
  useEffect(() => {
    if (!isComm) return;
    api.network.users.list({ pageSize: 100 }).then((r) => setDownline(r.rows)).catch(() => setDownline([]));
  }, [isComm]);
  const pickChild = (id) => { const next = { ...ff, branchChildId: String(ff.branchChildId) === String(id) ? '' : id }; setFf(next); setApplied(next); };
  const hasNetwork = isComm && (downline.length > 0 || (summary?.byChild || []).length > 0);

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
          {isComm ? <Fld label="Type"><Select value={ff.type} onChange={(v) => set('type', v)} searchable={false} options={TYPE_OPTIONS} /></Fld> : null}
          {hasNetwork ? <Fld label="Level"><Select value={ff.level} onChange={(v) => set('level', v)} searchable={false} options={LEVEL_OPTIONS} /></Fld> : null}
          {hasNetwork ? (
            <Fld label="Downline User"><Select value={ff.sourceUserId} onChange={(v) => set('sourceUserId', v)}
              options={[{ label: 'All', value: '' }, ...downline.map((u) => ({ label: `${u.user_code} · ${u.name} (${u.user_type_name})`, value: u.id }))]} /></Fld>
          ) : null}
          {hasNetwork ? (
            <Fld label="Through Direct User"><Select value={ff.branchChildId} onChange={(v) => set('branchChildId', v)}
              options={[{ label: 'All', value: '' }, ...(summary?.byChild || []).map((c) => ({ label: `${c.code} · ${c.name}`, value: c.child_id }))]} /></Fld>
          ) : null}
          <View style={[reportStyles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>
      {isComm && summary ? (
        <Card>
          <View style={cs.statRow}>
            <Stat label="Own transactions" value={money(summary.own)} />
            {hasNetwork ? <Stat label="From my downline" value={money(summary.fromDownline)} sub={`${summary.downlineTxns} payouts`} /> : null}
            {summary.charges ? <Stat label="Service charges" value={money(summary.charges)} bad /> : null}
          </View>
          {(summary.byChild || []).length ? (
            <>
              <Text style={cs.subHead}>Commission through each direct user (tap to filter)</Text>
              <View style={cs.childGrid}>
                {summary.byChild.map((c) => (
                  <Pressable key={c.child_id} onPress={() => pickChild(c.child_id)} style={[cs.child, String(applied.branchChildId) === String(c.child_id) && cs.childOn]}>
                    <Text style={cs.childName} numberOfLines={1}>{c.code} · {c.name}</Text>
                    <Text style={cs.childType}>{c.type_name}{c.is_active ? '' : ' · blocked'}</Text>
                    <Text style={cs.childNet}>{money(c.net)}</Text>
                    <Text style={cs.childType}>{c.txns} payouts</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </Card>
      ) : null}
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid rows={rows} loading={loading} rowKey={(r, i) => r.id || i} columns={columns}
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters} />
        {isComm && totals ? (
          <View style={cs.totals}>
            <Text style={cs.total}>Earned (net): <Text style={cs.totalVal}>{money(totals.net_credit)}</Text></Text>
            <Text style={cs.total}>Own: <Text style={cs.totalVal}>{money(totals.own)}</Text></Text>
            {hasNetwork ? <Text style={cs.total}>From downline: <Text style={cs.totalVal}>{money(totals.from_downline)}</Text></Text> : null}
            <Text style={cs.total}>Commission: <Text style={cs.totalVal}>{money(totals.commission)}</Text></Text>
            <Text style={cs.total}>GST: <Text style={cs.totalVal}>{money(totals.gst)}</Text></Text>
            <Text style={cs.total}>TDS: <Text style={cs.totalVal}>{money(totals.tds)}</Text></Text>
            {totals.charges ? <Text style={cs.total}>Charges: <Text style={[cs.totalVal, { color: colors.danger }]}>{money(totals.charges)}</Text></Text> : null}
          </View>
        ) : null}
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

const TYPE_OPTIONS = [{ label: 'All', value: '' }, { label: 'Commission (credit)', value: 'credit' }, { label: 'Service charge (debit)', value: 'debit' }];
const LEVEL_OPTIONS = [{ label: 'All', value: '' }, { label: 'Own transactions', value: 'own' }, { label: 'From downline', value: 'downline' }, { label: 'Level 1', value: '1' }, { label: 'Level 2', value: '2' }, { label: 'Level 3', value: '3' }];

const Stat = ({ label, value, sub, bad }) => (
  <View style={cs.stat}>
    <Text style={cs.statLabel}>{label}</Text>
    <Text style={[cs.statValue, bad && { color: colors.danger }]}>{value}</Text>
    {sub ? <Text style={cs.childType}>{sub}</Text> : null}
  </View>
);

const cs = StyleSheet.create({
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  stat: { flexGrow: 1, minWidth: 180, padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft, gap: 4 },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subHead: { marginTop: 16, marginBottom: 8, color: colors.text, fontWeight: '800', fontSize: 14 },
  childGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  child: { width: 200, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', gap: 2 },
  childOn: { borderColor: colors.primary, borderWidth: 2 },
  childName: { color: colors.text, fontWeight: '700', fontSize: 13 },
  childType: { color: colors.muted, fontSize: 11.5 },
  childNet: { color: colors.success, fontWeight: '800', fontSize: 16, marginTop: 2 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 },
  total: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  totalVal: { color: colors.text, fontWeight: '800' },
});
