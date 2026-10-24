import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Switch } from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import ActionIcon from '../components/ActionIcon';
import ConfirmDialog from '../components/ConfirmDialog';
import FormBar from '../components/FormBar';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { api } from '../api/client';
import { colors, radius } from '../theme';
import { Pager } from './AccountHistoryScreen';
import { fmtDateTime } from '../utils/dateTime';

const PAGE_SIZE = 10;
const EMPTY = { name: '', service: '', category: '', code: '', circleRequired: false, isActive: true };

// Operator Master: the operators (Airtel, Jio, Vi ...) the retailer screens, Commission Slots and SP Keys offer. An operator
// that is already used can be switched off but not renamed / deleted (slabs, SP keys and transactions keep its name).
export default function OperatorMasterScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [service, setService] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null); const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const grid = useGrid();
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const p = opts.page ?? page;
      const res = await api.operatorMaster.list({ ...grid.params, q: opts.q ?? q, service: opts.service ?? service, page: p, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, service, grid.sort, grid.filters]);
  useGridReload(grid, () => load({ page: 1 }));

  useEffect(() => { load({ page: 1 }); api.operatorMaster.groups().then((r) => setGroups(r.rows)).catch(() => {}); /* eslint-disable-next-line */ }, []);
  const firstQ = useRef(true);
  useEffect(() => {
    if (firstQ.current) { firstQ.current = false; return undefined; }
    const t = setTimeout(() => load({ page: 1, q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q]);

  const labelOf = (key) => (groups.find((g) => g.key === key) || {}).label || key;
  const groupOptions = groups.map((g) => ({ label: g.label, value: g.key }));

  const openAdd = () => { setEditing(null); setF({ ...EMPTY, service }); setFormError(null); setView('form'); };
  const openEdit = (r) => { setEditing(r); setF({ name: r.name, service: r.service, category: r.category || '', code: r.code || '', circleRequired: !!r.circle_required, isActive: !!r.is_active }); setFormError(null); setView('form'); };

  const save = async () => {
    if (f.name.trim().length < 2) { setFormError('Operator name must be at least 2 characters.'); return; }
    if (!f.service) { setFormError('Choose what the operator is for.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = { name: f.name.trim(), service: f.service, category: f.category.trim(), code: f.code.trim(), circleRequired: f.circleRequired, isActive: f.isActive };
      if (editing) await api.operatorMaster.update(editing.id, body); else await api.operatorMaster.create(body);
      setView('list'); await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const toggleStatus = async (r) => {
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, is_active: !r.is_active } : x))); // optimistic
    try { await api.operatorMaster.update(r.id, { isActive: !r.is_active }); } catch (e) {
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, is_active: r.is_active } : x))); setError(e.message);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.operatorMaster.remove(toDelete.id); setToDelete(null);
      await load({ page: rows.length === 1 && page > 1 ? page - 1 : page });
    } catch (e) { setToDelete(null); setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <FormBar heading={editing ? 'Edit Operator' : 'Add Operator'} saveTitle={editing ? 'Save' : 'Create'} onSave={save} saving={saving}
          onCancel={() => setView('list')} backTitle="← Back" onBack={() => setView('list')} error={formError} />
        <Card>
          <View style={styles.grid}>
            <View style={styles.field}><Text style={styles.label}>Operator Name *</Text>
              <TextInput value={f.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Jio" placeholderTextColor={colors.muted} style={styles.input} autoFocus /></View>
            <View style={styles.field}><Select label="Used For *" value={f.service} options={groupOptions} onChange={(v) => set('service', v)} placeholder="-- Select --" searchable={false} /></View>
            <View style={styles.field}><Text style={styles.label}>Category</Text>
              <TextInput value={f.category} onChangeText={(v) => set('category', v)} placeholder="e.g. Prepaid, Electricity (optional)" placeholderTextColor={colors.muted} style={styles.input} /></View>
            <View style={styles.field}><Text style={styles.label}>Code</Text>
              <TextInput value={f.code} onChangeText={(v) => set('code', v)} placeholder="Provider code (optional)" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="characters" /></View>
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Circle required</Text><Switch value={f.circleRequired} onValueChange={(v) => set('circleRequired', v)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={f.isActive} onValueChange={(v) => set('isActive', v)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
          </View>
          <Text style={styles.note}>An operator that is already used by a commission slab, an SP key or a transaction cannot be renamed or moved to another service; switch it off and add a new one. Commission and API rates per operator are set in Commission Slots and API Management → SP Keys & Commission.</Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.head}>
        <Text style={styles.heading}>{total} Operators</Text>
        <Button title="Create" onPress={openAdd} />
      </View>
      <Card>
        <View style={styles.grid}>
          <View style={styles.field}><Select label="Used For" value={service} options={[{ label: 'All', value: '' }, ...groupOptions]} onChange={(v) => { setService(v); load({ page: 1, service: v }); }} placeholder="All" searchable={false} /></View>
          <View style={styles.field}><Text style={styles.label}>Search</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Name, category or code" placeholderTextColor={colors.muted} style={styles.input} /></View>
        </View>
      </Card>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No operators found."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'name', title: 'Operator', flex: 1, minWidth: 180, render: (r) => <Text style={[styles.td, { fontWeight: '600' }]}>{r.name}</Text> },
            { key: 'service', title: 'Used For', width: 190, render: (r) => <Text style={styles.td}>{labelOf(r.service)}</Text> },
            { key: 'category', title: 'Category', width: 140 },
            { key: 'code', title: 'Code', width: 110 },
            { key: 'circle_required', title: 'Circle', width: 90, render: (r) => <Text style={styles.td}>{r.circle_required ? 'Yes' : 'No'}</Text> },
            { key: 'status', title: 'Status', width: 100, render: (r) => <Switch value={!!r.is_active} onValueChange={() => toggleStatus(r)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /> },
            { key: 'created_at', title: 'Created on', width: 175, render: (r) => <Text style={styles.td}>{fmtDateTime(r.created_at)}</Text> },
            { key: 'action', title: 'Action', width: 110, sortable: false, filterable: false, render: (r) => (
              <View style={styles.actions}><ActionIcon name="edit" onPress={() => openEdit(r)} /><ActionIcon name="delete" onPress={() => setToDelete(r)} /></View>
            ) },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={(p) => load({ page: p })} />
      </Card>
      <ConfirmDialog visible={!!toDelete} title="Delete Operator" loading={deleting} onConfirm={confirmDelete} onCancel={() => setToDelete(null)}
        message={<Text style={styles.para}>Delete <Text style={{ fontWeight: '700' }}>{toDelete?.name}</Text>? An operator that is already used cannot be deleted - switch it off instead.</Text>} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  heading: { fontSize: 21, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14 },
  field: { flexGrow: 1, flexBasis: '46%', minWidth: 220, gap: 6 },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  input: { minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  td: { color: colors.text, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 14 },
  note: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 16 },
  para: { color: colors.text, lineHeight: 21 },
});
