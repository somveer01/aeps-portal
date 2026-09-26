import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;
const COMMISSION_OPTIONS = [
  { label: 'By Percentage', value: 'percentage' },
  { label: 'By Amount', value: 'amount' },
];
const CHAIN_OPTIONS = [
  { label: 'Self', value: 'self' },
  { label: 'Chain', value: 'chain' },
];
const money = (v) => `Rs ${Number(v).toFixed(2)}`;
const valueLabel = (row) => (row.commission_type === 'percentage' ? `${Number(row.value).toFixed(2)} %` : money(row.value));
const commissionLabel = (t) => (t === 'amount' ? 'By Amount' : 'By Percentage');
const chainLabel = (t) => (t === 'chain' ? 'Chain' : 'Self');

export default function CommissionSlotScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [services, setServices] = useState([]); const [plans, setPlans] = useState([]);

  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ userTypeId: '', planId: '', serviceId: '', commissionType: '', minAmount: '', maxAmount: '', transactionType: '', specificUser: '', value: '', active: true });
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try { const res = await api.commissionSlots.list({ q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q]);

  useEffect(() => {
    load({ page: 1 });
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100 }).then((r) => setServices(r.rows)).catch(() => {});
    api.plans.list({ pageSize: 100 }).then((r) => setPlans(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const utOptions = userTypes.map((u) => ({ label: u.name, value: u.id }));
  const svcOptions = services.map((s) => ({ label: s.title, value: s.id }));
  // Plans filtered by the selected user type (falls back to all if none match).
  const planOptions = useMemo(() => {
    const filtered = plans.filter((p) => String(p.user_type_id) === String(form.userTypeId));
    return (filtered.length ? filtered : plans).map((p) => ({ label: p.name, value: p.id }));
  }, [plans, form.userTypeId]);

  const openAdd = () => {
    setEditing(null);
    setForm({ userTypeId: userTypes[0]?.id ?? '', planId: '', serviceId: services[0]?.id ?? '', commissionType: '', minAmount: '1', maxAmount: '1000', transactionType: '', specificUser: '', value: '', active: true });
    setFormError(null); setView('form');
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ userTypeId: row.user_type_id, planId: row.plan_id, serviceId: row.service_id, commissionType: row.commission_type, minAmount: String(row.min_amount), maxAmount: String(row.max_amount), transactionType: row.chain_type, specificUser: row.specific_user || '', value: String(row.value), active: row.is_active });
    setFormError(null); setView('form');
  };

  const save = async () => {
    if (!form.userTypeId || !form.planId || !form.serviceId) { setFormError('Please select user type, plan and service.'); return; }
    if (!form.commissionType) { setFormError('Please choose a commission type.'); return; }
    if (!form.transactionType) { setFormError('Please choose a transaction type.'); return; }
    const min = Number(form.minAmount); const max = Number(form.maxAmount); const val = Number(form.value);
    if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max < min) { setFormError('Enter a valid amount range (From ≤ To).'); return; }
    if (Number.isNaN(val) || val < 0) { setFormError('Enter a valid amount/percentage.'); return; }
    if (form.commissionType === 'percentage' && val > 100) { setFormError('Percentage cannot exceed 100.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = {
        userTypeId: form.userTypeId, serviceId: form.serviceId, planId: form.planId,
        commissionType: form.commissionType, minAmount: min, maxAmount: max, value: val,
        chainType: form.transactionType, specificUser: form.specificUser.trim(), isActive: form.active,
      };
      if (editing) await api.commissionSlots.update(editing.id, body); else await api.commissionSlots.create(body);
      setView('list'); await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await api.commissionSlots.update(row.id, { isActive: !row.is_active }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.commissionSlots.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); }
    catch (e) { setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);
  const pageNums = []; for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pageNums.push(i);

  // ── In-page Add/Edit form (opens in place, like the recording) ──
  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.formHeaderBar}>
          <Text style={styles.formHeading}>{editing ? 'Edit Commission Slot' : 'Add Commission Slot'}</Text>
          <Button title="ALL SLOTS" onPress={() => setView('list')} style={{ paddingHorizontal: 18 }} />
        </View>
        <Card>
          {formError ? <Alert type="error">{formError}</Alert> : null}
          <View style={styles.grid}>
            {/* Row 1: User Type, Plan, Service, Commission Type */}
            <View style={styles.field}><Select label="User Type *" value={form.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="Select user type" /></View>
            <View style={styles.field}><Select label="Plan *" value={form.planId} options={planOptions} onChange={(v) => set('planId', v)} placeholder="-- Select Plan --" /></View>
            <View style={styles.field}><Select label="Service *" value={form.serviceId} options={svcOptions} onChange={(v) => set('serviceId', v)} placeholder="-- Choose --" /></View>
            <View style={styles.field}><Select label="Commission Type *" value={form.commissionType} options={COMMISSION_OPTIONS} onChange={(v) => set('commissionType', v)} placeholder="-- Choose --" searchable={false} /></View>

            {/* Row 2: From Amount, To Amount, Transaction Type, For Any Specific User */}
            <View style={styles.field}><Text style={styles.label}>From Amount *</Text>
              <TextInput value={form.minAmount} onChangeText={(v) => set('minAmount', v)} keyboardType="numeric" placeholder="From Amount" placeholderTextColor={colors.muted} style={styles.modalInput} /></View>
            <View style={styles.field}><Text style={styles.label}>To Amount *</Text>
              <TextInput value={form.maxAmount} onChangeText={(v) => set('maxAmount', v)} keyboardType="numeric" placeholder="To Amount" placeholderTextColor={colors.muted} style={styles.modalInput} /></View>
            <View style={styles.field}><Select label="Transaction Type *" value={form.transactionType} options={CHAIN_OPTIONS} onChange={(v) => set('transactionType', v)} placeholder="-- Choose --" searchable={false} /></View>
            <View style={styles.field}><Text style={styles.label}>For Any Specific User</Text>
              <TextInput value={form.specificUser} onChangeText={(v) => set('specificUser', v)} placeholder="Enter User Login Id" placeholderTextColor={colors.muted} style={styles.modalInput} autoCapitalize="none" /></View>

            {/* Dynamic field: appears once a Commission Type is chosen */}
            {form.commissionType ? (
              <View style={styles.field}>
                <Text style={styles.label}>{form.commissionType === 'percentage' ? 'Commission Percentage (%) *' : 'Commission Amount (Rs) *'}</Text>
                <TextInput value={form.value} onChangeText={(v) => set('value', v)} keyboardType="numeric" placeholder={form.commissionType === 'percentage' ? '2.00' : '5.00'} placeholderTextColor={colors.muted} style={styles.modalInput} />
              </View>
            ) : (
              <View style={styles.field}><Text style={styles.hint}>Choose a Commission Type to enter its percentage / amount value.</Text></View>
            )}
            <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={form.active} onValueChange={(v) => set('active', v)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
          </View>

          <View style={styles.formActions}>
            <Button title="Cancel" variant="ghost" onPress={() => setView('list')} style={{ minWidth: 120 }} />
            <Button title={editing ? 'Save' : 'Submit'} onPress={save} loading={saving} style={{ minWidth: 150 }} />
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.actionBar}><Button title="+ ADD NEW SLOT" onPress={openAdd} style={{ paddingHorizontal: 20 }} /></View>
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All Commission Slots</Text>
          <View style={styles.searchWrap}><Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Service, user type or plan…" placeholderTextColor={colors.muted} style={styles.search} /></View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: 1000, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.colNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.colUt, styles.thText]}>User Type</Text>
              <Text style={[styles.cell, styles.colSvc, styles.thText]}>Service</Text>
              <Text style={[styles.cell, styles.colCt, styles.thText]}>Commission Type</Text>
              <Text style={[styles.cell, styles.colRange, styles.thText]}>Amount Range</Text>
              <Text style={[styles.cell, styles.colVal, styles.thText]}>Amount / Percentage</Text>
              <Text style={[styles.cell, styles.colPlan, styles.thText]}>Plan</Text>
              <Text style={[styles.cell, styles.colChain, styles.thText]}>Chain Type</Text>
              <Text style={[styles.cell, styles.colStatus, styles.thText]}>Status</Text>
              <Text style={[styles.cell, styles.colAction, styles.thText]}>Action</Text>
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No commission slots found.</Text></View>
                : rows.map((row, i) => (
                  <View key={row.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.colNo, styles.td]}>{from + i}</Text>
                    <Text style={[styles.cell, styles.colUt, styles.td]}>{row.user_type_name}</Text>
                    <View style={[styles.cell, styles.colSvc]}>
                      <Text style={styles.td}>{row.service_name}</Text>
                      {row.operator ? <Text style={styles.subLabel}>{row.operator}</Text> : null}
                    </View>
                    <Text style={[styles.cell, styles.colCt, styles.td]}>{commissionLabel(row.commission_type)}</Text>
                    <Text style={[styles.cell, styles.colRange, styles.td]}>{money(row.min_amount)} - {Number(row.max_amount).toFixed(2)}</Text>
                    <Text style={[styles.cell, styles.colVal, styles.td]}>{valueLabel(row)}</Text>
                    <Text style={[styles.cell, styles.colPlan, styles.td]}>{row.plan_name}</Text>
                    <Text style={[styles.cell, styles.colChain, styles.td]}>{chainLabel(row.chain_type)}</Text>
                    <View style={[styles.cell, styles.colStatus]}><Switch value={!!row.is_active} onValueChange={() => toggleStatus(row)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
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
            {pageNums.map((n) => (<Pressable key={n} onPress={() => load({ page: n })} style={[styles.pageBtn, n === page && styles.pageCurrent]}><Text style={n === page ? { color: '#fff', fontWeight: '700' } : styles.pageBtnText}>{n}</Text></Pressable>))}
            <Pressable disabled={page >= totalPages} onPress={() => load({ page: page + 1 })} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Next</Text></Pressable>
          </View>
        </View>
      </Card>

      <Modal visible={!!toDelete} transparent animationType="fade" onRequestClose={() => setToDelete(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Commission Slot</Text>
            <Text style={styles.para}>Delete the slot for <Text style={{ fontWeight: '700' }}>{toDelete?.service_name}</Text> ({toDelete?.user_type_name})? This cannot be undone.</Text>
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
  thText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  cell: { paddingVertical: 12, paddingHorizontal: 8 },
  td: { color: colors.text, fontSize: 13.5 },
  subLabel: { color: colors.primary, fontSize: 11, fontWeight: '600', marginTop: 2 },
  colNo: { width: 38 }, colUt: { width: 110 }, colSvc: { width: 120 }, colCt: { width: 120 }, colRange: { width: 150 }, colVal: { width: 130 }, colPlan: { width: 140 }, colChain: { width: 90 }, colStatus: { width: 70 }, colAction: { width: 80 },
  actions: { flexDirection: 'row', gap: 12 },
  empty: { padding: 30, alignItems: 'center' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 }, pageBtnText: { color: colors.text }, pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 460, maxHeight: '90%' },
  modalCardWide: { backgroundColor: '#fff', borderRadius: radius.md, padding: 24, width: '100%', maxWidth: 720, maxHeight: '90%', gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  hint: { fontSize: 12.5, color: colors.muted, fontStyle: 'italic', paddingTop: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14, paddingBottom: 4 },
  field: { flexGrow: 1, flexBasis: '46%', minWidth: 200, gap: 6 },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTwo: { flexDirection: 'row', gap: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalActions: { flexDirection: 'row', gap: 12 },
  para: { color: colors.text, lineHeight: 21 },
});
