import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView, Image,
} from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import ActionIcon from '../components/ActionIcon';
import { api, assetUrl } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { pickImage } from '../api/imagePicker';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;
const TYPE_OPTIONS = [
  { label: 'Login Page', value: 'login' },
  { label: 'App', value: 'app' },
];
const typeLabel = (t) => (TYPE_OPTIONS.find((o) => o.value === t) || {}).label || 'Login Page';
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0'); const mon = d.toLocaleString('en-US', { month: 'short' });
  let h = d.getHours(); const ampm = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${day} ${mon} ${d.getFullYear()} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

export default function ApplicationBannerScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState(''); const [image, setImage] = useState(null);
  const [type, setType] = useState('login'); const [active, setActive] = useState(true);
  const [imgBusy, setImgBusy] = useState(false); const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try { const res = await api.banners.list({ ...grid.params, q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, grid.sort, grid.filters]);
  useGridReload(grid, () => load({ page: 1 }));
  useEffect(() => { load({ page: 1 }); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const openAdd = () => { setEditing(null); setTitle(''); setImage(null); setType('login'); setActive(true); setFormError(null); setView('form'); };
  const openEdit = (r) => { setEditing(r); setTitle(r.title); setImage(r.image || null); setType(r.type || 'login'); setActive(r.is_active); setFormError(null); setView('form'); };

  const chooseImage = async () => {
    setFormError(null);
    try { const picked = await pickImage(); if (!picked) return; setImgBusy(true); const { path } = await api.uploadImage(picked); setImage(path); }
    catch (e) { setFormError(e.message || 'Upload failed'); } finally { setImgBusy(false); }
  };

  const save = async () => {
    const t = title.trim();
    if (t.length < 2) { setFormError('Title must be at least 2 characters.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = { title: t, image: image || '', type, isActive: active };
      if (editing) await api.banners.update(editing.id, body); else await api.banners.create(body);
      setView('list'); await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };
  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await api.banners.update(row.id, { isActive: !row.is_active }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.banners.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); }
    catch (e) { setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.formHeaderBar}>
          <Text style={styles.formHeading}>{editing ? 'Edit Banner' : 'Add Banner'}</Text>
          <Button title="ALL BANNERS" onPress={() => setView('list')} style={{ paddingHorizontal: 18 }} />
        </View>
        <Card>
          {formError ? <Alert type="error">{formError}</Alert> : null}
          <View style={styles.grid}>
            <View style={styles.field}><Text style={styles.label}>Banner Title *</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Mobile Recharge" placeholderTextColor={colors.muted} style={styles.input} autoFocus /></View>
            <View style={styles.field}><Select label="Type *" value={type} options={TYPE_OPTIONS} onChange={setType} searchable={false} placeholder="-- Choose --" /></View>
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
            <View style={styles.fieldFull}>
              <Text style={styles.label}>Banner Image</Text>
              <View style={styles.imageRow}>
                {image ? <Image source={{ uri: assetUrl(image) }} style={styles.bannerImg} resizeMode="cover" />
                  : <View style={[styles.bannerImg, styles.imgEmpty]}><Text style={{ color: '#94a3b8' }}>No image</Text></View>}
                <View style={{ gap: 6 }}>
                  <Button title={image ? 'Change image' : 'Upload image'} variant="ghost" onPress={chooseImage} loading={imgBusy} style={{ minWidth: 140 }} />
                  {image ? <Pressable onPress={() => setImage(null)}><Text style={{ color: colors.danger, fontWeight: '600', fontSize: 12 }}>Remove</Text></Pressable> : null}
                </View>
              </View>
            </View>
          </View>
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
      <View style={styles.actionBar}><Button title="+ ADD NEW BANNER" onPress={openAdd} style={{ paddingHorizontal: 20 }} /></View>
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All Banners</Text>
          <View style={styles.searchWrap}><Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.muted} style={styles.search} /></View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No banners found."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (row, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'title', title: 'Title', flex: 1, minWidth: 180 },
            { key: 'image', title: 'Image', width: 110, sortable: false, filterable: false, render: (row) => (row.image ? <Image source={{ uri: assetUrl(row.image) }} style={styles.thumb} resizeMode="cover" /> : <View style={[styles.thumb, styles.imgEmpty]}><Text style={{ color: '#94a3b8', fontSize: 10 }}>none</Text></View>) },
            { key: 'type', title: 'Type', width: 130, render: (row) => <Text style={styles.td}>{typeLabel(row.type)}</Text> },
            { key: 'created_at', title: 'Created on', width: 175, render: (row) => <Text style={styles.td}>{fmtDate(row.created_at)}</Text> },
            { key: 'updated_at', title: 'Updated on', width: 175, render: (row) => <Text style={styles.td}>{fmtDate(row.updated_at)}</Text> },
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
            <Text style={styles.modalTitle}>Delete Banner</Text>
            <Text style={styles.para}>Delete <Text style={{ fontWeight: '700' }}>{toDelete?.title}</Text>? This cannot be undone.</Text>
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
  fieldFull: { width: '100%', gap: 6 },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchLabel: { color: colors.muted },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, minWidth: 180, color: colors.text, outlineStyle: 'none' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bannerImg: { width: 220, height: 90, borderRadius: radius.sm, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border },
  imgEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 80, height: 40, borderRadius: 6, backgroundColor: '#f1f5f9' },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  trAlt: { backgroundColor: '#f8fafc' },
  th: { backgroundColor: colors.primary, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  thText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cell: { paddingVertical: 12, paddingHorizontal: 10 },
  td: { color: colors.text, fontSize: 14 },
  colNo: { width: 40 }, colTitle: { flex: 1, minWidth: 130 }, colImg: { width: 90 }, colType: { width: 100 }, colDate: { width: 155 }, colStatus: { width: 70 }, colAction: { width: 80 },
  actions: { flexDirection: 'row', gap: 14 },
  empty: { padding: 30, alignItems: 'center' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 }, pageBtnText: { color: colors.text }, pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 420, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
});
