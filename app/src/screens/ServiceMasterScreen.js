import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView, Image,
} from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api, assetUrl } from '../api/client';
import { pickImage } from '../api/imagePicker';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;
const TYPE_OPTIONS = [
  { label: 'Internal Service', value: 'internal' },
  { label: 'External Service', value: 'external' },
];

function fmtDate(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short' });
  let h = d.getHours(); const ampm = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${day} ${mon} ${d.getFullYear()} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
const typeLabel = (t) => (t === 'external' ? 'External Service' : 'Internal Service');
const PC_OPTIONS = [
  { label: 'Percentage of amount (%)', value: 'percentage' },
  { label: 'Flat amount per transaction (Rs)', value: 'amount' },
];
const pcLabel = (row) => (Number(row.provider_commission_value) > 0
  ? (row.provider_commission_type === 'amount' ? `Rs ${Number(row.provider_commission_value).toFixed(2)}` : `${Number(row.provider_commission_value).toFixed(2)} %`)
  : '—');

export default function ServiceMasterScreen() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);

  const [view, setView] = useState('list');
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [serviceType, setServiceType] = useState('internal');
  const [icon, setIcon] = useState(null); // stored path like /uploads/x.png
  const [iconBusy, setIconBusy] = useState(false);
  const [active, setActive] = useState(true);
  const [pcType, setPcType] = useState('percentage');
  const [pcValue, setPcValue] = useState('0');
  const [dailyLimit, setDailyLimit] = useState('0');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const res = await api.services.list({ q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q]);

  useEffect(() => {
    load({ page: 1 });
    api.serviceCategoryOptions().then((r) => setCategories(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const catOptions = categories.map((c) => ({ label: c.name, value: c.id }));

  const openAdd = () => { setEditing(null); setTitle(''); setCategoryId(categories[0]?.id ?? ''); setServiceType('internal'); setIcon(null); setActive(true); setPcType('percentage'); setPcValue('0'); setDailyLimit('0'); setFormError(null); setView('form'); };
  const openEdit = (row) => { setEditing(row); setTitle(row.title); setCategoryId(row.service_category_id); setServiceType(row.service_type); setIcon(row.icon || null); setActive(row.is_active); setPcType(row.provider_commission_type || 'percentage'); setPcValue(String(Number(row.provider_commission_value || 0))); setDailyLimit(String(Number(row.daily_limit || 0))); setFormError(null); setView('form'); };

  const chooseIcon = async () => {
    setFormError(null);
    try {
      const picked = await pickImage();
      if (!picked) return;
      setIconBusy(true);
      const { path } = await api.uploadImage(picked);
      setIcon(path);
    } catch (e) { setFormError(e.message || 'Icon upload failed'); } finally { setIconBusy(false); }
  };

  const save = async () => {
    const t = title.trim();
    if (t.length < 2) { setFormError('Service title must be at least 2 characters.'); return; }
    if (!categoryId) { setFormError('Please select a service category.'); return; }
    const pc = Number(pcValue === '' ? 0 : pcValue);
    if (!Number.isFinite(pc) || pc < 0) { setFormError('Provider commission must be a number of 0 or more.'); return; }
    if (pcType === 'percentage' && pc > 100) { setFormError('Provider commission % cannot be above 100.'); return; }
    const dl = Number(dailyLimit === '' ? 0 : dailyLimit);
    if (!Number.isFinite(dl) || dl < 0) { setFormError('Daily limit must be 0 (no limit) or more.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = { title: t, serviceCategoryId: categoryId, serviceType, icon: icon || '', isActive: active, providerCommissionType: pcType, providerCommissionValue: pc, dailyLimit: dl };
      if (editing) await api.services.update(editing.id, body);
      else await api.services.create(body);
      setView('list');
      await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await api.services.update(row.id, { isActive: !row.is_active }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.services.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); }
    catch (e) { setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const pageNums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pageNums.push(i);

  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.formHeaderBar}>
          <Text style={styles.formHeading}>{editing ? 'Edit Service' : 'Add New Service'}</Text>
          <Button title="ALL SERVICES" onPress={() => setView('list')} style={{ paddingHorizontal: 18 }} />
        </View>
        <Card>
          {formError ? <Alert type="error">{formError}</Alert> : null}
          <View style={styles.grid}>
            <View style={styles.field}><Text style={styles.label}>Service Title *</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Mobile Recharge" placeholderTextColor={colors.muted} style={styles.modalInput} autoFocus /></View>
            <View style={styles.field}><Select label="Service Category *" value={categoryId} options={catOptions} onChange={setCategoryId} placeholder="Select a category" /></View>
            <View style={styles.field}><Select label="Service Type *" value={serviceType} options={TYPE_OPTIONS} onChange={setServiceType} searchable={false} /></View>
            <View style={styles.field}><Select label="Provider Commission Type" value={pcType} options={PC_OPTIONS} onChange={setPcType} searchable={false} /></View>
            <View style={styles.field}><Text style={styles.label}>{pcType === 'amount' ? 'Provider Commission (Rs per transaction)' : 'Provider Commission (%)'}</Text>
              <TextInput value={pcValue} onChangeText={setPcValue} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.muted} style={styles.modalInput} /></View>
            <View style={styles.field}><Text style={styles.label}>Daily Limit per User (Rs)</Text>
              <TextInput value={dailyLimit} onChangeText={setDailyLimit} keyboardType="numeric" placeholder="0 = no limit" placeholderTextColor={colors.muted} style={styles.modalInput} /></View>
            <View style={styles.fieldFull}><Text style={styles.hint}>Daily limit: the most one user can transact on this service in a day (successful transactions). 0 means no limit. Switching the service off (Active) blocks it for everyone.</Text></View>
            <View style={styles.fieldFull}><Text style={styles.hint}>What the API provider pays you for each successful transaction of this service. Admin Margin = this, plus service charges collected, minus the commission paid to users.</Text></View>
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
            <View style={styles.fieldFull}>
              <Text style={styles.label}>Icon</Text>
              <View style={styles.iconRow}>
                {icon ? (
                  <Image source={{ uri: assetUrl(icon) }} style={styles.iconPreview} resizeMode="cover" />
                ) : (
                  <View style={[styles.iconPreview, styles.rowIconEmpty]}><Text style={{ color: '#94a3b8', fontSize: 11 }}>none</Text></View>
                )}
                <Button title={icon ? 'Change icon' : 'Upload icon'} variant="ghost" onPress={chooseIcon} loading={iconBusy} style={{ maxWidth: 220 }} />
                {icon ? <Pressable onPress={() => setIcon(null)} style={styles.iconRemove}><Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text></Pressable> : null}
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
      <View style={styles.actionBar}><Button title="+ ADD NEW SERVICE" onPress={openAdd} style={{ paddingHorizontal: 20 }} /></View>

      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All Services</Text>
          <View style={styles.searchWrap}>
            <Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Service or category…" placeholderTextColor={colors.muted} style={styles.search} />
          </View>
        </View>

        {error ? <Alert type="error">{error}</Alert> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: 1090, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.colNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.colTitle, styles.thText]}>Service Title</Text>
              <Text style={[styles.cell, styles.colCat, styles.thText]}>Service Category</Text>
              <Text style={[styles.cell, styles.colType, styles.thText]}>Service Type</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.colPc, styles.thText]}>Provider Comm.</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.colLimit, styles.thText]}>Daily Limit</Text>
              <Text style={[styles.cell, styles.colDate, styles.thText]}>Created on</Text>
              <Text style={[styles.cell, styles.colStatus, styles.thText]}>Status</Text>
              <Text style={[styles.cell, styles.colAction, styles.thText]}>Action</Text>
            </View>

            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No services found.</Text></View>
                : rows.map((row, i) => (
                  <View key={row.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.colNo, styles.td]}>{from + i}</Text>
                    <View style={[styles.cell, styles.colTitle, styles.titleCell]}>
                      {row.icon ? (
                        <Image source={{ uri: assetUrl(row.icon) }} style={styles.rowIcon} resizeMode="cover" />
                      ) : (
                        <View style={[styles.rowIcon, styles.rowIconEmpty]}><Text style={{ color: '#94a3b8', fontSize: 12 }}>{row.title[0]}</Text></View>
                      )}
                      <Text style={styles.td} numberOfLines={1}>{row.title}</Text>
                    </View>
                    <Text style={[styles.cell, styles.colCat, styles.td]}>{row.category_name}</Text>
                    <Text style={[styles.cell, styles.colType, styles.td]}>{typeLabel(row.service_type)}</Text>
                    <Text style={[styles.cell, styles.colPc, styles.td]}>{pcLabel(row)}</Text>
                    <Text style={[styles.cell, styles.colLimit, styles.td]}>{Number(row.daily_limit) > 0 ? `Rs ${Number(row.daily_limit).toFixed(2)}` : 'No limit'}</Text>
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
            {pageNums.map((n) => (
              <Pressable key={n} onPress={() => load({ page: n })} style={[styles.pageBtn, n === page && styles.pageCurrent]}>
                <Text style={n === page ? { color: '#fff', fontWeight: '700' } : styles.pageBtnText}>{n}</Text>
              </Pressable>
            ))}
            <Pressable disabled={page >= totalPages} onPress={() => load({ page: page + 1 })} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Next</Text></Pressable>
          </View>
        </View>
      </Card>

      {/* Delete modal */}
      <Modal visible={!!toDelete} transparent animationType="fade" onRequestClose={() => setToDelete(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Service</Text>
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
  colNo: { width: 44 },
  colTitle: { flex: 1.2, minWidth: 150 },
  colCat: { flex: 1, minWidth: 140 },
  colType: { width: 130 }, colPc: { width: 140 }, colLimit: { width: 130 },
  colDate: { width: 175 },
  colStatus: { width: 80 },
  colAction: { width: 90 },
  actions: { flexDirection: 'row', gap: 14 },
  titleCell: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#f1f5f9' },
  rowIconEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  empty: { padding: 30, alignItems: 'center' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconPreview: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#f1f5f9' },
  iconRemove: { paddingHorizontal: 8, paddingVertical: 8 },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { color: colors.text },
  pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 440, gap: 12 },
  modalCardWide: { backgroundColor: '#fff', borderRadius: radius.md, padding: 24, width: '100%', maxWidth: 640, maxHeight: '90%', gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14, paddingBottom: 4 },
  field: { flexGrow: 1, flexBasis: '46%', minWidth: 200, gap: 6 },
  fieldFull: { width: '100%', gap: 6 },
  hint: { fontSize: 12.5, color: colors.muted },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 21 },
});
