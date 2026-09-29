import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;

function fmtDate(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short' });
  let h = d.getHours(); const ampm = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${day} ${mon} ${d.getFullYear()} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

export default function UserTypeMasterScreen() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [view, setView] = useState('list');
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [parentTypeId, setParentTypeId] = useState('');
  const [allTypes, setAllTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const res = await api.userTypes.list({ q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q]);

  const loadAllTypes = () => api.userTypes.list({ pageSize: 100 }).then((r) => setAllTypes(r.rows)).catch(() => {});
  useEffect(() => { load({ page: 1 }); loadAllTypes(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const openAdd = () => { setEditing(null); setName(''); setActive(true); setParentTypeId(''); setFormError(null); setView('form'); };
  const openEdit = (row) => { setEditing(row); setName(row.name); setActive(row.is_active); setParentTypeId(row.parent_type_id || ''); setFormError(null); setView('form'); };
  const parentOptions = [{ label: '— None (top level) —', value: '' }, ...allTypes.filter((t) => !editing || t.id !== editing.id).map((t) => ({ label: t.name, value: t.id }))];

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) { setFormError('Name must be at least 2 characters.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = { name: trimmed, isActive: active, parentTypeId: parentTypeId || null };
      if (editing) await api.userTypes.update(editing.id, body);
      else await api.userTypes.create(body);
      setView('list');
      loadAllTypes();
      await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await api.userTypes.update(row.id, { isActive: !row.is_active }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.userTypes.remove(toDelete.id); setToDelete(null);
      await load({ page: rows.length === 1 && page > 1 ? page - 1 : page });
    } catch (e) { setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.formHeaderBar}>
          <Text style={styles.formHeading}>{editing ? 'Edit User Type' : 'Add User Type'}</Text>
          <Button title="ALL USER TYPES" onPress={() => setView('list')} style={{ paddingHorizontal: 18 }} />
        </View>
        <Card>
          {formError ? <Alert type="error">{formError}</Alert> : null}
          <View style={styles.grid}>
            <View style={styles.field}><Text style={styles.label}>User Type Name *</Text>
              <TextInput value={name} onChangeText={setName} placeholder="e.g. Distributor" placeholderTextColor={colors.muted} style={styles.modalInput} autoFocus onSubmitEditing={save} /></View>
            <View style={styles.field}><Select label="Parent Type" value={parentTypeId} options={parentOptions} onChange={setParentTypeId} searchable={false} /></View>
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
          </View>
          <Text style={styles.hint}>Parent Type is the user type directly above this one (e.g. Retailer → Distributor). Users of the parent type get a My Network panel where they can create users of this type, send them balance and see their reports.</Text>
          <View style={styles.formActions}>
            <Button title="Cancel" variant="ghost" onPress={() => setView('list')} style={{ minWidth: 120 }} />
            <Button title={editing ? 'Save' : 'Create'} onPress={save} loading={saving} style={{ minWidth: 150 }} />
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.actionBar}><Button title="+ ADD NEW" onPress={openAdd} style={{ paddingHorizontal: 20 }} /></View>

      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All User Types</Text>
          <View style={styles.searchWrap}>
            <Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.muted} style={styles.search} />
          </View>
        </View>

        {error ? <Alert type="error">{error}</Alert> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: 820, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.colNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.colName, styles.thText]}>User Type</Text>
              <Text style={[styles.cell, styles.colParent, styles.thText]}>Parent Type</Text>
              <Text style={[styles.cell, styles.colDate, styles.thText]}>Created on</Text>
              <Text style={[styles.cell, styles.colStatus, styles.thText]}>Status</Text>
              <Text style={[styles.cell, styles.colAction, styles.thText]}>Action</Text>
            </View>

            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No user types found.</Text></View>
                : rows.map((row, i) => (
                  <View key={row.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.colNo, styles.td]}>{from + i}</Text>
                    <Text style={[styles.cell, styles.colName, styles.td]}>{row.name}</Text>
                    <Text style={[styles.cell, styles.colParent, styles.td]}>{row.parent_type_name || '—'}</Text>
                    <Text style={[styles.cell, styles.colDate, styles.td]}>{fmtDate(row.created_at)}</Text>
                    <View style={[styles.cell, styles.colStatus]}>
                      <Switch value={!!row.is_active} onValueChange={() => toggleStatus(row)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" />
                    </View>
                    <View style={[styles.cell, styles.colAction, styles.actions]}>
                      <Pressable onPress={() => openEdit(row)} hitSlop={6}><Text style={{ color: colors.primary, fontSize: 16 }}>✏️</Text></Pressable>
                      <Pressable onPress={() => setToDelete(row)} hitSlop={6}><Text style={{ color: colors.danger, fontSize: 16 }}>🗑️</Text></Pressable>
                    </View>
                  </View>
                ))}
          </View>
        </ScrollView>

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
            <Text style={styles.modalTitle}>Delete User Type</Text>
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
  colNo: { width: 50 },
  colName: { flex: 1, minWidth: 160 }, colParent: { width: 180 },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 14 },
  colDate: { width: 190 },
  colStatus: { width: 90 },
  colAction: { width: 100 },
  actions: { flexDirection: 'row', gap: 14 },
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
