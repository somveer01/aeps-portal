import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, StatusBadge } from '../components/UI';
import ActionIcon from '../components/ActionIcon';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors, radius } from '../theme';
import { Pager, reportStyles } from './AccountHistoryScreen';

// My Network → Commission Packages. A package sets what my direct downline earns per service.
// The money comes out of my own share (the admin's total never changes); the most I can give
// for a service is the admin default for that user type plus my own share.
const PAGE_SIZE = 10;
const fmt = (type, v) => (v == null ? '—' : type === 'amount' ? `Rs ${Number(v).toFixed(2)}` : `${Number(v)}%`);
const fmtDate = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`; };
const TYPE_OPTIONS = [{ label: '%', value: 'percentage' }, { label: 'Rs', value: 'amount' }];

export default function CommissionPackageScreen() {
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(undefined); // undefined = list, null = new, row = edit
  const [toDelete, setToDelete] = useState(null); const [delError, setDelError] = useState(null); const [deleting, setDeleting] = useState(false);
  const grid = useGrid();

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const r = await api.network.packages.list({ ...grid.params, page: p, pageSize: PAGE_SIZE }); setRows(r.rows); setTotal(r.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
    /* eslint-disable-next-line */
  }, [page, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));
  useEffect(() => {
    load(1);
    api.network.packages.meta().then((m) => setMeta(m.childTypes)).catch((e) => setError(e.message));
    /* eslint-disable-next-line */
  }, []);

  const remove = async (unassign) => {
    setDeleting(true); setDelError(null);
    try {
      const r = await api.network.packages.remove(toDelete.id, unassign);
      setNotice(`Package "${toDelete.name}" deleted${r.unassigned ? `; ${r.unassigned} user(s) are back on the admin default` : ''}.`);
      setToDelete(null); await load(1);
    } catch (e) { setDelError(e.message); } finally { setDeleting(false); }
  };

  if (editing !== undefined) {
    return <PackageForm meta={meta || []} pkg={editing} onBack={() => setEditing(undefined)}
      onSaved={(row) => { setNotice(`Package "${row.name}" saved.`); setEditing(undefined); load(1); }} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={reportStyles.heading}>{total} Commission Packages</Text>
        <Button title="+ NEW PACKAGE" onPress={() => { setNotice(null); setEditing(null); }} disabled={!meta || !meta.length} />
      </View>
      <Text style={styles.note}>Give a package to a user directly under you (My Users → Edit). What they earn comes out of your own share — you can never give more than you earn. Users without a package get the admin default.</Text>
      {meta && !meta.length ? <Alert type="info">There is no user type below yours, so there is nobody to make packages for.</Alert> : null}
      <Alert type="success">{notice}</Alert>
      <Card>
        <Alert>{error}</Alert>
        <DataGrid
          rows={rows} loading={loading} emptyText="No packages yet. Make one, then give it to your users."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={reportStyles.td}>{from + i}</Text> },
            { key: 'name', title: 'Package', width: 180, render: (r) => <Text style={[reportStyles.td, { fontWeight: '700' }]}>{r.name}</Text> },
            { key: 'user_type', title: 'For', width: 140, render: (r) => <Text style={reportStyles.td}>{r.user_type_name}</Text> },
            { key: 'rates', title: 'Rates', flex: 1, minWidth: 260, sortable: false, filterable: false, render: (r) => <Text style={reportStyles.td} numberOfLines={3}>{r.items.map((i) => `${i.service_name}${i.operator ? ` (${i.operator})` : ''} ${fmt(i.commission_type, i.value)}`).join(' · ') || '—'}</Text> },
            { key: 'users', title: 'Users', width: 90, render: (r) => <Text style={reportStyles.td}>{r.users_count}</Text> },
            { key: 'status', title: 'Status', width: 110, render: (r) => <StatusBadge label={r.is_active ? 'Active' : 'Off'} tone={r.is_active ? 'success' : 'muted'} /> },
            { key: 'created_at', title: 'Created', width: 130, render: (r) => <Text style={reportStyles.td}>{fmtDate(r.created_at)}</Text> },
            { key: 'action', title: 'Action', width: 110, sortable: false, filterable: false, render: (r) => (
              <View style={styles.actions}>
                <ActionIcon name="edit" onPress={() => { setNotice(null); setEditing(r); }} />
                <ActionIcon name="delete" onPress={() => { setDelError(null); setToDelete(r); }} />
              </View>
            ) },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>

      <Modal visible={!!toDelete} transparent animationType="fade" onRequestClose={() => setToDelete(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Delete package</Text>
            <Text style={reportStyles.td}>Delete <Text style={{ fontWeight: '700' }}>{toDelete?.name}</Text>?{toDelete?.users_count ? ` ${toDelete.users_count} user(s) use it and will go back to the admin default.` : ''}</Text>
            <Alert>{delError}</Alert>
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setToDelete(null)} style={{ flex: 1 }} />
              <Button title="Delete" onPress={() => remove(!!toDelete?.users_count)} loading={deleting} style={{ flex: 1, backgroundColor: colors.danger }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PackageForm({ meta, pkg, onBack, onSaved }) {
  const [name, setName] = useState(pkg ? pkg.name : '');
  const [typeId, setTypeId] = useState(pkg ? pkg.user_type_id : (meta[0] ? meta[0].id : ''));
  const [active, setActive] = useState(pkg ? !!pkg.is_active : true);
  // serviceId -> { type, value } ; an empty value = not in the package (admin default applies)
  const [rates, setRates] = useState(() => Object.fromEntries((pkg ? pkg.items : []).filter((i) => !i.operator).map((i) => [i.service_id, { type: i.commission_type, value: String(Number(i.value)) }])));
  const [saving, setSaving] = useState(false); const [error, setError] = useState(null);
  const type = useMemo(() => meta.find((t) => String(t.id) === String(typeId)), [meta, typeId]);
  const setRate = (sid, patch) => setRates((r) => ({ ...r, [sid]: { type: 'percentage', value: '', ...r[sid], ...patch } }));

  const save = async () => {
    setError(null);
    const items = (type ? type.services : []).map((s) => ({ s, r: rates[s.serviceId] }))
      .filter(({ r }) => r && String(r.value).trim() !== '')
      .map(({ s, r }) => ({ serviceId: s.serviceId, commissionType: r.type || s.maxType || 'percentage', value: Number(r.value) }));
    // operator-specific items of an existing package are kept as they were
    const keep = pkg ? pkg.items.filter((i) => i.operator).map((i) => ({ serviceId: i.service_id, operator: i.operator, commissionType: i.commission_type, value: Number(i.value) })) : [];
    setSaving(true);
    try {
      const body = { name: name.trim(), userTypeId: typeId, isActive: active, items: [...items, ...keep] };
      const r = pkg ? await api.network.packages.update(pkg.id, body) : await api.network.packages.create(body);
      onSaved(r.row);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={reportStyles.heading}>{pkg ? 'Edit Package' : 'New Package'}</Text>
        <Button title="ALL PACKAGES" onPress={onBack} />
      </View>
      <Card>
        <Alert>{error}</Alert>
        <View style={reportStyles.grid}>
          <View style={reportStyles.field}><Text style={reportStyles.label}>Package Name *</Text>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Gold Retailer" placeholderTextColor={colors.muted} style={reportStyles.input} /></View>
          <View style={reportStyles.field}><Select label="For user type *" value={typeId} options={meta.map((t) => ({ label: t.name, value: t.id }))} onChange={setTypeId} searchable={false} /></View>
          <View style={[reportStyles.field, styles.switchField]}><Text style={reportStyles.label}>Active</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
        </View>
        <Text style={styles.note}>Leave a rate empty to keep the admin default for that service. "You keep" is your share after giving this rate.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: 10 }}>
        <View style={{ minWidth: COLS.reduce((a, b) => a + b, 0), flex: 1 }}>
        <View style={[reportStyles.tr, reportStyles.th]}>
          {['Service', 'Admin default', 'Your share', 'Most you can give', 'Package rate', 'You keep'].map((h, i) => (
            <Text key={h} style={[reportStyles.cell, reportStyles.thText, { width: COLS[i] }]}>{h}</Text>
          ))}
        </View>
        {!type || !type.services.length ? <View style={reportStyles.empty}><Text style={{ color: colors.muted }}>This user type cannot use any service yet (Service Permissions).</Text></View>
          : type.services.map((s, i) => {
            const r = rates[s.serviceId] || { type: s.maxType || 'percentage', value: '' };
            const v = Number(r.value);
            const keep = String(r.value).trim() !== '' && s.max != null && r.type === s.maxType ? Math.round((s.max - v) * 100) / 100 : null;
            return (
              <View key={s.serviceId} style={[reportStyles.tr, i % 2 ? reportStyles.trAlt : null]}>
                <Text style={[reportStyles.cell, reportStyles.td, { width: COLS[0], fontWeight: '600' }]}>{s.title}</Text>
                <Text style={[reportStyles.cell, reportStyles.td, { width: COLS[1] }]}>{s.defaults.length ? s.defaults.map((d) => `${fmt(d.type, d.value)}${s.defaults.length > 1 ? ` (${d.plan})` : ''}`).join(', ') : 'none'}</Text>
                <Text style={[reportStyles.cell, reportStyles.td, { width: COLS[2] }]}>{s.myShare ? fmt(s.myShare.type, s.myShare.value) : 'none'}</Text>
                <Text style={[reportStyles.cell, reportStyles.td, { width: COLS[3] }]}>{s.max != null ? fmt(s.maxType, s.max) : 'capped at your share'}</Text>
                <View style={[reportStyles.cell, { width: COLS[4], flexDirection: 'row', gap: 6, alignItems: 'center' }]}>
                  <TextInput value={r.value} onChangeText={(t) => setRate(s.serviceId, { value: t.replace(/[^0-9.]/g, ''), type: r.type })} placeholder="default" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={[reportStyles.input, styles.rateInput]} />
                  <View style={{ width: 100 }}><Select value={r.type} options={TYPE_OPTIONS} onChange={(t) => setRate(s.serviceId, { type: t, value: r.value })} searchable={false} /></View>
                </View>
                <Text style={[reportStyles.cell, reportStyles.td, { width: COLS[5], color: keep != null && keep < 0 ? colors.danger : colors.text, fontWeight: '700' }]}>{keep == null ? '—' : keep < 0 ? 'too high' : fmt(s.maxType, keep)}</Text>
              </View>
            );
          })}
        </View>
        </ScrollView>
        <View style={styles.formActions}>
          <Button title="Cancel" variant="ghost" onPress={onBack} style={{ minWidth: 120 }} />
          <Button title={pkg ? 'Save' : 'Create'} onPress={save} loading={saving} style={{ minWidth: 150 }} />
        </View>
      </Card>
    </View>
  );
}

const COLS = [170, 160, 100, 140, 290, 110];

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  note: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 14 },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rateInput: { flex: 1, paddingVertical: 8, paddingHorizontal: 10 },
  formActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 440, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
});
