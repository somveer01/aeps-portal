import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Card, Button, Alert } from '../components/UI';
import ActionIcon from '../components/ActionIcon';
import { FioriPage, FioriHeader, FioriPanel, FioriToolbar, FioriSearch, FioriButton, FioriPager } from '../components/Fiori';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors, radius } from '../theme';
import FormBar from '../components/FormBar';

const PAGE_SIZE = 10;

function fmtDate(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short' });
  let h = d.getHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${d.getFullYear()} ${String(h).padStart(2, '0')}:${min} ${ampm}`;
}

export default function ServiceCategoryScreen() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // add/edit modal
  const [view, setView] = useState('list');
  const [editing, setEditing] = useState(null); // row or null
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // delete modal
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const p = opts.page ?? page;
      const query = opts.q ?? q;
      const res = await api.serviceCategories.list({ ...grid.params, q: query, page: p, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, grid.sort, grid.filters]);
  useGridReload(grid, () => load({ page: 1 }));

  useEffect(() => { load({ page: 1 }); /* eslint-disable-next-line */ }, []);

  // debounced search (skips the mount run so data doesn't load twice → no blink)
  const firstQ = useRef(true);
  useEffect(() => {
    if (firstQ.current) { firstQ.current = false; return undefined; }
    const t = setTimeout(() => load({ page: 1, q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q]);

  const openAdd = () => { setEditing(null); setName(''); setActive(true); setFormError(null); setView('form'); };
  const openEdit = (row) => { setEditing(row); setName(row.name); setActive(row.is_active); setFormError(null); setView('form'); };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) { setFormError('Name must be at least 2 characters.'); return; }
    setSaving(true); setFormError(null);
    try {
      if (editing) await api.serviceCategories.update(editing.id, { name: trimmed, isActive: active });
      else await api.serviceCategories.create({ name: trimmed, isActive: active });
      setView('list');
      await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const toggleStatus = async (row) => {
    // optimistic
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try {
      await api.serviceCategories.update(row.id, { isActive: !row.is_active });
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r)));
      setError(e.message);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.serviceCategories.remove(toDelete.id);
      setToDelete(null);
      const nextPage = rows.length === 1 && page > 1 ? page - 1 : page;
      await load({ page: nextPage });
    } catch (e) { setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <FormBar saveTitle={editing ? 'Save' : 'Create'} onSave={save} saving={saving}
          onCancel={() => setView('list')} backTitle="← Back" onBack={() => setView('list')} error={formError} />
        <Card>
          <View style={styles.grid}>
            <View style={styles.field}><Text style={styles.label}>Service Category Name *</Text>
              <TextInput value={name} onChangeText={setName} placeholder="e.g. B2B Services" placeholderTextColor={colors.muted} style={styles.modalInput} autoFocus onSubmitEditing={save} /></View>
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <FioriPage>
      <FioriHeader count={total} unit="category" actions={<FioriButton title="Create" onPress={openAdd} />} />

      <FioriPanel>
        {error ? <Alert type="error">{error}</Alert> : null}

        {/* Table */}
        <DataGrid
          rows={rows} loading={loading} emptyText="No service categories found."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (row, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'name', title: 'Service Category', flex: 1, minWidth: 200 },
            { key: 'status', title: 'Status', width: 100, render: (row) => <Switch value={!!row.is_active} onValueChange={() => toggleStatus(row)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /> },
            { key: 'created_at', title: 'Created on', width: 175, render: (row) => <Text style={styles.td}>{fmtDate(row.created_at)}</Text> },
            { key: 'action', title: 'Action', width: 110, sortable: false, filterable: false, render: (row) => (
              <View style={styles.actions}>
                <ActionIcon name="edit" onPress={() => openEdit(row)} />
                <ActionIcon name="delete" onPress={() => setToDelete(row)} />
              </View>
            ) },
          ]}
        />

        <FioriPager from={from} to={to} total={total} page={page} totalPages={totalPages} onPage={(p) => load({ page: p })} />
      </FioriPanel>

      {/* Delete confirm modal */}
      <Modal visible={!!toDelete} transparent animationType="fade" onRequestClose={() => setToDelete(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Service Category</Text>
            <Text style={styles.para}>Are you sure you want to delete <Text style={{ fontWeight: '700' }}>{toDelete?.name}</Text>? This cannot be undone.</Text>
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setToDelete(null)} style={{ flex: 1 }} />
              <Button title="Delete" onPress={confirmDelete} loading={deleting} style={{ flex: 1, backgroundColor: colors.danger }} />
            </View>
          </View>
        </View>
      </Modal>
    </FioriPage>
  );
}

const styles = StyleSheet.create({
  actionBar: { flexDirection: 'row', justifyContent: 'flex-end' },
  formHeaderBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  formHeading: { fontSize: 20, fontWeight: '700', color: colors.text },
  formActions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 12, marginTop: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14 },
  field: { flexGrow: 1, flexBasis: '46%', minWidth: 220, gap: 6 },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchLabel: { color: colors.muted },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, minWidth: 180, color: colors.text, outlineStyle: 'none' },

  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  trAlt: { backgroundColor: '#f8fafc' },
  th: { backgroundColor: colors.primary, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  thText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cell: { paddingVertical: 12, paddingHorizontal: 10 },
  td: { color: colors.text, fontSize: 14 },
  colNo: { width: 50 },
  colName: { flex: 1, minWidth: 160 },
  colStatus: { width: 90 },
  colDate: { width: 190 },
  colAction: { width: 100 },
  actions: { flexDirection: 'row', gap: 14 },
  iconBtn: { padding: 2 },
  empty: { padding: 30, alignItems: 'center' },

  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { color: colors.text },
  pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 420, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 21 },
});
