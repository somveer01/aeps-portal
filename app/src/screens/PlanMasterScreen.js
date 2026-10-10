import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import ActionIcon from '../components/ActionIcon';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors, radius } from '../theme';
import FormBar from '../components/FormBar';
import { fmtDateTime as fmtDate } from '../utils/dateTime';

const PAGE_SIZE = 10;

export default function PlanMasterScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]);
  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [userTypeId, setUserTypeId] = useState(''); const [name, setName] = useState(''); const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try { const res = await api.plans.list({ ...grid.params, q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, grid.sort, grid.filters]);
  useGridReload(grid, () => load({ page: 1 }));

  useEffect(() => { load({ page: 1 }); api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {}); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const utOptions = userTypes.map((u) => ({ label: u.name, value: u.id }));
  const openAdd = () => { setEditing(null); setName(''); setUserTypeId(userTypes[0]?.id ?? ''); setActive(true); setFormError(null); setView('form'); };
  const openEdit = (row) => { setEditing(row); setName(row.name); setUserTypeId(row.user_type_id); setActive(row.is_active); setFormError(null); setView('form'); };

  const save = async () => {
    const t = name.trim();
    if (!userTypeId) { setFormError('Please select a user type.'); return; }
    if (t.length < 2) { setFormError('Plan name must be at least 2 characters.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = { userTypeId, name: t, isActive: active };
      if (editing) await api.plans.update(editing.id, body); else await api.plans.create(body);
      setView('list'); await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };
  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await api.plans.update(row.id, { isActive: !row.is_active }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.plans.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); }
    catch (e) { setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  // ── In-page Add/Edit form (opens in place, like the recording) ──
  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <FormBar heading={editing ? 'Edit Plan' : 'Add New Plan'} saveTitle={editing ? 'Save' : 'Submit'} onSave={save} saving={saving}
          onCancel={() => setView('list')} backTitle="ALL PLANS" onBack={() => setView('list')} error={formError} />
        <Card>
          <View style={styles.grid}>
            <View style={styles.field}><Select label="Select User Type *" value={userTypeId} options={utOptions} onChange={setUserTypeId} placeholder="Select a user type" /></View>
            <View style={styles.field}><Text style={styles.label}>Plan Name *</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Enter plan title" placeholderTextColor={colors.muted} style={styles.modalInput} onSubmitEditing={save} /></View>
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.actionBar}><Button title="+ ADD NEW PLAN" onPress={openAdd} style={{ paddingHorizontal: 20 }} /></View>
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All Plans</Text>
          <View style={styles.searchWrap}><Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Plan or user type…" placeholderTextColor={colors.muted} style={styles.search} /></View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No plans found."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (row, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'user_type', title: 'User Type', width: 180, render: (row) => <Text style={styles.td}>{row.user_type_name}</Text> },
            { key: 'name', title: 'Plan Name', flex: 1, minWidth: 180 },
            { key: 'created_at', title: 'Created on', width: 175, render: (row) => <Text style={styles.td}>{fmtDate(row.created_at)}</Text> },
            { key: 'status', title: 'Status', width: 100, render: (row) => <Switch value={!!row.is_active} onValueChange={() => toggleStatus(row)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /> },
            { key: 'action', title: 'Action', width: 110, sortable: false, filterable: false, render: (row) => (
              <View style={styles.actions}>
                <ActionIcon name="edit" onPress={() => openEdit(row)} />
                <ActionIcon name="delete" onPress={() => setToDelete(row)} />
              </View>
            ) },
          ]}
        />
        <View style={styles.pagination}>
          <Text style={styles.entries}>Showing {from} to {to} of {total} entries</Text>
          <View style={styles.pager}>
            <Pressable disabled={page <= 1} onPress={() => load({ page: page - 1 })} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Previous</Text></Pressable>
            <View style={[styles.pageBtn, styles.pageCurrent]}><Text style={{ color: '#fff', fontWeight: '700' }}>{page}</Text></View>
            <Pressable disabled={page >= totalPages} onPress={() => load({ page: page + 1 })} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Next</Text></Pressable>
          </View>
        </View>
      </Card>

      <Modal visible={!!toDelete} transparent animationType="fade" onRequestClose={() => setToDelete(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Plan</Text>
            <Text style={styles.para}>Delete <Text style={{ fontWeight: '700' }}>{toDelete?.name}</Text>? This cannot be undone.</Text>
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setToDelete(null)} style={{ flex: 1 }} />
              <Button title="Delete" onPress={confirmDelete} loading={deleting} style={{ flex: 1, backgroundColor: colors.danger }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
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
  colNo: { width: 50 }, colUt: { flex: 1, minWidth: 130 }, colName: { flex: 1.2, minWidth: 150 }, colDate: { width: 185 }, colStatus: { width: 80 }, colAction: { width: 90 },
  actions: { flexDirection: 'row', gap: 14 },
  empty: { padding: 30, alignItems: 'center' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 }, pageBtnText: { color: colors.text }, pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 440, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 21 },
});
