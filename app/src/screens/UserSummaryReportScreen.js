import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import UserPicker from '../components/UserPicker';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const money = (v) => { const n = Number(v || 0); return `${n < 0 ? '-' : ''}₹${Math.abs(n).toFixed(2)}`; };
const marginColor = (v) => (Number(v) < 0 ? colors.danger : colors.success);

// Admin: one row per user (everything they did, earned and paid in the date range); click a row for the per-service split.
export default function UserSummaryReportScreen() {
  const [picked, setPicked] = useState(null); // the user whose per-service detail is open
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '' });
  const [applied, setApplied] = useState({});
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const grid = useGrid();
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try {
      const res = await api.reports.userSummary({ ...applied, ...grid.params, page: p, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setTotals(res.totals); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => { api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {}); }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  if (picked) return <Detail user={picked} range={applied} onBack={() => setPicked(null)} />;

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);
  const commissionOut = totals ? Number(totals.own_commission) + Number(totals.network_commission) : 0;

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} Users — User Summary</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="User Type"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="All" /></Fld>
          <Fld label="User Id"><UserPicker mode="admin" scope="downline" value={ff.userId} onChange={(v) => set('userId', v)} placeholder="All users" /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <View style={styles.tiles}>
        <Tile label="Transactions" value={String(totals?.txns ?? 0)} sub={`${totals?.success ?? 0} success · ${totals?.failed ?? 0} failed · ${totals?.pending ?? 0} pending`} />
        <Tile label="Success Volume" value={money(totals?.volume)} />
        <Tile label="Commission Paid To Users" value={money(commissionOut)} sub={`own ${money(totals?.own_commission)} · from downline ${money(totals?.network_commission)}`} />
        <Tile label="Service Charges Paid" value={money(totals?.charges_paid)} />
        <Tile label="Company Margin" value={money(totals?.company_margin)} color={marginColor(totals?.company_margin)} strong />
      </View>
      <Text style={styles.note}>One row per user for the dates above. Commission is what the user earned (own = on their own transactions, from downline = on their downline's transactions, incl. GST). Wallet added = approved fund requests + fund transfers received (net of debits). Company margin = what the company kept on that user's own transactions. Click a row to see the same numbers per service.</Text>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} onRowPress={setPicked}
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'user', title: 'User', width: 200, render: (r) => <View><Text style={styles.td}>{r.user_name}{r.is_active ? '' : ' (blocked)'}</Text><Text style={styles.sub}>{r.user_code}</Text></View> },
            { key: 'user_type_name', title: 'User Type', width: 130 },
            { key: 'parent_code', title: 'Parent', width: 110, render: (r) => <Text style={styles.td}>{r.parent_code || 'Admin'}</Text> },
            { key: 'txns', title: 'Transactions', width: 130, render: (r) => <View><Text style={styles.td}>{r.txns}</Text><Text style={styles.sub}>{r.success} ok · {r.failed} failed · {r.pending} pending</Text></View> },
            { key: 'volume', title: 'Success Volume', width: 130, render: (r) => <Text style={styles.td}>{money(r.volume)}</Text> },
            { key: 'own_commission', title: 'Commission (Own)', width: 140, render: (r) => <Text style={styles.td}>{money(r.own_commission)}</Text> },
            { key: 'network_commission', title: 'Commission (Downline)', width: 160, render: (r) => <Text style={styles.td}>{money(r.network_commission)}</Text> },
            { key: 'charges_paid', title: 'Charges Paid', width: 120, render: (r) => <Text style={styles.td}>{money(r.charges_paid)}</Text> },
            { key: 'refunds', title: 'Refunds', width: 110, render: (r) => <Text style={styles.td}>{money(r.refunds)}</Text> },
            { key: 'wallet_added', title: 'Wallet Added', width: 125, render: (r) => <Text style={styles.td}>{money(r.wallet_added)}</Text> },
            { key: 'company_margin', title: 'Company Margin', width: 135, render: (r) => <Text style={{ color: marginColor(r.company_margin), fontWeight: '700', fontSize: 13 }}>{money(r.company_margin)}</Text> },
            { key: 'wallet_balance', title: 'Balance Now', width: 125, render: (r) => <Text style={styles.td}>{money(r.wallet_balance)}</Text> },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

// One user, split per service for the same date range.
function Detail({ user, range, onBack }) {
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  useEffect(() => {
    api.reports.userSummaryDetail(user.id, { startDate: range.startDate || '', endDate: range.endDate || '' }).then(setData).catch((e) => setError(e.message));
    /* eslint-disable-next-line */
  }, [user.id]);
  const u = data ? data.user : user;
  const dates = range.startDate || range.endDate ? `${range.startDate || 'start'} to ${range.endDate || 'today'}` : 'all dates';

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.detailHead}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.heading}>{u.user_name} ({u.user_code})</Text>
          <Text style={styles.note}>{u.user_type_name} · parent {u.parent_code || 'Admin'} · balance {money(u.wallet_balance)} · {dates}</Text>
        </View>
        <Button title="ALL USERS" variant="ghost" onPress={onBack} />
      </View>
      {error ? <Alert type="error">{error}</Alert> : null}
      {data ? (
        <>
          <View style={styles.tiles}>
            <Tile label="Transactions" value={String(u.txns)} sub={`${u.success} success · ${u.failed} failed · ${u.pending} pending`} />
            <Tile label="Success Volume" value={money(u.volume)} />
            <Tile label="Commission Earned" value={money(Number(u.own_commission) + Number(u.network_commission))} sub={`own ${money(u.own_commission)} · from downline ${money(u.network_commission)}`} />
            <Tile label="Charges Paid" value={money(u.charges_paid)} />
            <Tile label="Wallet Added" value={money(u.wallet_added)} sub={`refunds ${money(u.refunds)}`} />
            <Tile label="Company Margin" value={money(u.company_margin)} color={marginColor(u.company_margin)} strong />
          </View>
          <Card>
            <Text style={styles.cardTitle}>By service</Text>
            <DataGrid
              rows={data.services} loading={false} rowKey={(r) => r.service} emptyText="No transactions or commission in this period."
              columns={[
                { key: 'service', title: 'Service', width: 180, sortable: false, filterable: false },
                { key: 'txns', title: 'Transactions', width: 140, sortable: false, filterable: false, render: (r) => <View><Text style={styles.td}>{r.txns}</Text><Text style={styles.sub}>{r.success} ok · {r.failed} failed · {r.pending} pending</Text></View> },
                { key: 'volume', title: 'Success Volume', width: 140, sortable: false, filterable: false, render: (r) => <Text style={styles.td}>{money(r.volume)}</Text> },
                { key: 'own_commission', title: 'Commission (Own)', width: 150, sortable: false, filterable: false, render: (r) => <Text style={styles.td}>{money(r.own_commission)}</Text> },
                { key: 'network_commission', title: 'Commission (Downline)', width: 170, sortable: false, filterable: false, render: (r) => <Text style={styles.td}>{money(r.network_commission)}</Text> },
                { key: 'charges_paid', title: 'Charges Paid', width: 130, sortable: false, filterable: false, render: (r) => <Text style={styles.td}>{money(r.charges_paid)}</Text> },
                { key: 'company_margin', title: 'Company Margin', width: 145, sortable: false, filterable: false, render: (r) => <Text style={{ color: marginColor(r.company_margin), fontWeight: '700', fontSize: 13 }}>{money(r.company_margin)}</Text> },
              ]}
            />
          </Card>
          <Text style={styles.note}>Commission "from downline" on a service is what this user earned when someone below them used that service. For every single transaction open Reports → Service Report, and Commission & Margin → Admin Margin for the margin per transaction.</Text>
        </>
      ) : null}
    </View>
  );
}

function Tile({ label, value, sub, color, strong }) {
  return (
    <Card style={[styles.tile, strong && { borderTopColor: color || colors.primary }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, color ? { color } : null]}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  tile: { flexGrow: 1, flexBasis: 200, minWidth: 180, gap: 6, borderTopWidth: 3, borderTopColor: colors.border },
  tileLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  tileSub: { color: colors.muted, fontSize: 12 },
  note: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  detailHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 10 },
});
