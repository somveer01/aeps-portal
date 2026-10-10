import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import ActionIcon from '../components/ActionIcon';
import UserPicker from '../components/UserPicker';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;
const COMMISSION_OPTIONS = [
  { label: 'By Percentage', value: 'percentage' },
  { label: 'By Amount', value: 'amount' },
];
const CHAIN_OPTIONS = [
  { label: 'Self (only own transactions)', value: 'self' },
  { label: 'Chain (own + downline transactions)', value: 'chain' },
];
const money = (v) => `Rs ${Number(v).toFixed(2)}`;
const valueLabel = (row) => (row.commission_type === 'percentage' ? `${Number(row.value).toFixed(2)} %` : money(row.value));
const commissionLabel = (t) => (t === 'amount' ? 'By Amount' : 'By Percentage');
const chainLabel = (t) => (t === 'chain' ? 'Chain' : 'Self');
// Short text for a slot inside the matrix: "Chain 4%", "Self Rs 5.00", "Debit Rs 5.00".
const chipLabel = (r) => `${r.txn_type === 'debit' ? 'Debit' : chainLabel(r.chain_type)} ${r.commission_type === 'percentage' ? `${Number(r.value)}%` : money(r.value)}`;

export default function CommissionSlotScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [services, setServices] = useState([]); const [plans, setPlans] = useState([]);

  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ userTypeId: '', planId: '', serviceId: '', commissionType: '', minAmount: '', maxAmount: '', transactionType: '', specificUser: '', operator: '', value: '', active: true });
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);
  // Matrix tab (default): every slot laid out as service x user type, like Service Permissions.
  const [tab, setTab] = useState('matrix');
  const [allSlots, setAllSlots] = useState(null); const [allServices, setAllServices] = useState([]);
  const [chainGaps, setChainGaps] = useState([]); // types with a downline but no chain slab for a service
  const loadMatrix = useCallback(async () => {
    api.commissionSlots.chainGaps().then((r) => setChainGaps(r.rows)).catch(() => setChainGaps([]));
    try {
      const out = [];
      for (let p = 1; ; p += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r = await api.commissionSlots.list({ page: p, pageSize: 100 });
        out.push(...r.rows);
        if (out.length >= r.total || !r.rows.length) break;
      }
      setAllSlots(out);
    } catch (e) { setError(e.message); }
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Operator / Mode choices for the selected service ({ kind: 'operator'|'mode'|null, options }).
  const [opChoices, setOpChoices] = useState({ kind: null, options: [] });
  useEffect(() => {
    if (!form.serviceId) { setOpChoices({ kind: null, options: [] }); return; }
    let live = true;
    api.commissionSlots.operatorOptions(form.serviceId).then((r) => { if (live) setOpChoices(r); }).catch(() => {});
    return () => { live = false; };
  }, [form.serviceId]);

  const grid = useGrid(); // DataGrid column sort + filters (All Slots tab)
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try { const res = await api.commissionSlots.list({ ...grid.params, q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, grid.sort, grid.filters]);
  useGridReload(grid, () => load({ page: 1 }));

  useEffect(() => {
    load({ page: 1 });
    loadMatrix();
    api.services.list({ pageSize: 100 }).then((r) => setAllServices(r.rows)).catch(() => {});
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100, active: true }).then((r) => setServices(r.rows)).catch(() => {});
    api.plans.list({ pageSize: 100 }).then((r) => setPlans(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const utOptions = userTypes.map((u) => ({ label: u.name, value: u.id }));
  // Only switched-on services are offered; a slot being edited keeps its (possibly switched-off) service.
  const svcOptions = services.map((s) => ({ label: s.title, value: s.id }));
  if (editing && !services.some((s) => s.id === editing.service_id)) svcOptions.push({ label: `${editing.service_name} (off)`, value: editing.service_id });
  // Plans filtered by the selected user type (falls back to all if none match).
  const planOptions = useMemo(() => {
    const filtered = plans.filter((p) => String(p.user_type_id) === String(form.userTypeId));
    return (filtered.length ? filtered : plans).map((p) => ({ label: p.name, value: p.id }));
  }, [plans, form.userTypeId]);

  const openAdd = (prefill = {}) => {
    setEditing(null);
    setForm({ userTypeId: prefill.userTypeId ?? userTypes[0]?.id ?? '', planId: '', serviceId: prefill.serviceId ?? services[0]?.id ?? '', commissionType: '', minAmount: '1', maxAmount: '1000', transactionType: '', specificUser: '', operator: '', value: '', active: true });
    setFormError(null); setView('form');
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ userTypeId: row.user_type_id, planId: row.plan_id, serviceId: row.service_id, commissionType: row.commission_type, minAmount: String(row.min_amount), maxAmount: String(row.max_amount), transactionType: row.chain_type, specificUser: row.specific_user || '', operator: row.operator || '', value: String(row.value), active: row.is_active });
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
        chainType: form.transactionType, specificUser: form.specificUser.trim(), operator: form.operator.trim(), isActive: form.active,
      };
      if (editing) await api.commissionSlots.update(editing.id, body); else await api.commissionSlots.create(body);
      setView('list'); await load({ page: editing ? page : 1 }); loadMatrix();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await api.commissionSlots.update(row.id, { isActive: !row.is_active }); loadMatrix(); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.commissionSlots.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); loadMatrix(); }
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
            <View style={styles.field}><Select label="User Type *" value={form.userTypeId} options={utOptions} onChange={(v) => setForm((f) => ({ ...f, userTypeId: v, specificUser: String(v) === String(f.userTypeId) ? f.specificUser : '' }))} placeholder="Select user type" /></View>
            <View style={styles.field}><Select label="Plan *" value={form.planId} options={planOptions} onChange={(v) => set('planId', v)} placeholder="-- Select Plan --" /></View>
            <View style={styles.field}><Select label="Service *" value={form.serviceId} options={svcOptions} onChange={(v) => set('serviceId', v)} placeholder="-- Choose --" /></View>
            <View style={styles.field}><Select label="Commission Type *" value={form.commissionType} options={COMMISSION_OPTIONS} onChange={(v) => set('commissionType', v)} placeholder="-- Choose --" searchable={false} /></View>

            {/* Row 2: From Amount, To Amount, Transaction Type, For Any Specific User */}
            <View style={styles.field}><Text style={styles.label}>From Amount *</Text>
              <TextInput value={form.minAmount} onChangeText={(v) => set('minAmount', v)} keyboardType="numeric" placeholder="From Amount" placeholderTextColor={colors.muted} style={styles.modalInput} /></View>
            <View style={styles.field}><Text style={styles.label}>To Amount *</Text>
              <TextInput value={form.maxAmount} onChangeText={(v) => set('maxAmount', v)} keyboardType="numeric" placeholder="To Amount" placeholderTextColor={colors.muted} style={styles.modalInput} /></View>
            <View style={styles.field}><Select label="Transaction Type *" value={form.transactionType} options={CHAIN_OPTIONS} onChange={(v) => set('transactionType', v)} placeholder="-- Choose --" searchable={false} /></View>
            <View style={styles.field}>
              {/* Search by login id, name, shop or mobile; only users of the chosen user type. Empty = every user of the type. */}
              <UserPicker label="For Any Specific User" valueKey="user_code" mode="admin" userTypeId={form.userTypeId}
                value={form.specificUser} onChange={(v) => set('specificUser', v)} placeholder={form.userTypeId ? 'All users of this type (search to pick one)' : 'Choose the user type first'} disabled={!form.userTypeId} />
            </View>
            <View style={styles.field}>
              <Select label={opChoices.kind === 'mode' ? 'Transfer Mode' : 'Operator'} value={form.operator} onChange={(v) => set('operator', v)}
                options={[
                  { label: opChoices.kind === 'mode' ? 'All modes' : 'All operators', value: '' },
                  ...opChoices.options.map((o) => ({ label: o, value: o })),
                  // An older value that is not in the list stays visible so editing never drops it silently.
                  ...(form.operator && !opChoices.options.some((o) => o.toLowerCase() === form.operator.toLowerCase()) ? [{ label: `${form.operator} (not in list)`, value: form.operator }] : []),
                ]} />
              <Text style={[styles.hint, { paddingTop: 4 }]}>{opChoices.kind ? 'All = pays on every one. A slot for one operator wins over the "All" slot for that operator.' : 'This service has no operator choice.'}</Text></View>

            {/* Dynamic field: appears once a Commission Type is chosen */}
            {form.commissionType ? (
              <View style={styles.field}>
                <Text style={styles.label}>{form.commissionType === 'percentage' ? 'Commission Percentage (%) *' : 'Commission Amount (Rs) *'}</Text>
                <TextInput value={form.value} onChangeText={(v) => set('value', v)} keyboardType="numeric" placeholder={form.commissionType === 'percentage' ? '2.00' : '5.00'} placeholderTextColor={colors.muted} style={styles.modalInput} />
              </View>
            ) : (
              <View style={styles.field}><Text style={styles.hint}>Choose a Commission Type to enter its percentage / amount value.</Text></View>
            )}
            <View style={styles.field}><Text style={styles.hint}>A Chain slab also pays this user type when anyone below them in the parent chain completes this service, on top of that user's own commission.</Text></View>
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
      <View style={[styles.actionBar, { justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={styles.tabs}>
          {[['matrix', 'By Service × User Type'], ['list', 'All Slots']].map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]}><Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}</Text></Pressable>
          ))}
        </View>
        <Button title="+ ADD NEW SLOT" onPress={() => openAdd()} style={{ paddingHorizontal: 20 }} />
      </View>
      {chainGaps.length ? (
        <View style={styles.gapBox}>
          <Text style={styles.gapTitle}>Earns nothing from the downline (no active credit "Chain" slab)</Text>
          {Object.entries(chainGaps.reduce((m, g) => ({ ...m, [g.userType]: [...(m[g.userType] || []), g.service] }), {})).map(([type, svcs]) => (
            <Text key={type} style={styles.gapLine}><Text style={{ fontWeight: '800' }}>{type}</Text>: {svcs.join(', ')}</Text>
          ))}
          <Text style={styles.gapHint}>Add a slab with Chain Type = Chain for these, or leave it if they should earn nothing on that service.</Text>
        </View>
      ) : null}
      {tab === 'matrix' ? (
        <SlotMatrix slots={allSlots} services={allServices} userTypes={userTypes} error={error} onEdit={openEdit} onAdd={openAdd} />
      ) : (
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All Commission Slots</Text>
          <View style={styles.searchWrap}><Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Service, user type or plan…" placeholderTextColor={colors.muted} style={styles.search} /></View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No commission slots found."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (row, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'user_type', title: 'User Type', width: 140, render: (row) => <Text style={styles.td}>{row.user_type_name}</Text> },
            { key: 'service', title: 'Service', width: 170, render: (row) => <View><Text style={styles.td}>{row.service_name}</Text>{row.operator ? <Text style={styles.subLabel}>{row.operator}</Text> : null}</View> },
            { key: 'commission_type', title: 'Commission Type', width: 145, render: (row) => <Text style={styles.td}>{commissionLabel(row.commission_type)}</Text> },
            { key: 'range', title: 'Amount Range', width: 170, render: (row) => <Text style={styles.td}>{money(row.min_amount)} - {Number(row.max_amount).toFixed(2)}</Text> },
            { key: 'value', title: 'Amount / Percentage', width: 155, render: (row) => <Text style={styles.td}>{valueLabel(row)}</Text> },
            { key: 'plan', title: 'Plan', width: 150, render: (row) => <Text style={styles.td}>{row.plan_name}</Text> },
            { key: 'chain_type', title: 'Chain Type', width: 110, render: (row) => <Text style={styles.td}>{chainLabel(row.chain_type)}</Text> },
            { key: 'status', title: 'Status', width: 100, render: (row) => <Switch value={!!row.is_active} onValueChange={() => toggleStatus(row)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /> },
            { key: 'action', title: 'Action', width: 100, sortable: false, filterable: false, render: (row) => (
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
            {pageNums.map((n) => (<Pressable key={n} onPress={() => load({ page: n })} style={[styles.pageBtn, n === page && styles.pageCurrent]}><Text style={n === page ? { color: '#fff', fontWeight: '700' } : styles.pageBtnText}>{n}</Text></Pressable>))}
            <Pressable disabled={page >= totalPages} onPress={() => load({ page: page + 1 })} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Next</Text></Pressable>
          </View>
        </View>
      </Card>
      )}

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

// Rows = services, columns = user types; each cell lists that type's slots for the service.
function SlotMatrix({ slots, services, userTypes, error, onEdit, onAdd }) {
  if (!slots) return <Card><ActivityIndicator color={colors.primary} /></Card>;
  const used = new Set(slots.map((r) => r.service_id));
  // Switched-on services, plus switched-off ones that still have slots.
  const rows = services.filter((s) => s.is_active || used.has(s.id));
  const cell = (s, t) => slots.filter((r) => r.service_id === s.id && r.user_type_id === t.id);
  // Commission slots of a cell that all name an operator: list them (the rest of the operators pay nothing).
  const gap = (list) => {
    const earn = list.filter((r) => r.is_active && r.txn_type !== 'debit');
    return earn.length && earn.every((r) => r.operator) ? [...new Set(earn.map((r) => r.operator))].join(', ') : '';
  };
  return (
    <Card>
      <Text style={styles.matrixHint}>Commission for each user type, service-wise. Self = on own transactions, Chain = also on the downline's, Debit = charge taken from the user. Tap a slot to edit, + Add for that service and user type.</Text>
      {error ? <Alert type="error">{error}</Alert> : null}
      <ScrollView horizontal>
        <View style={{ minWidth: 220 + userTypes.length * 190 }}>
          <View style={[styles.tr, styles.th]}>
            <View style={[styles.cell, styles.mSvc]}><Text style={styles.thText}>Service</Text></View>
            {userTypes.map((t) => <View key={t.id} style={[styles.cell, styles.mType]}><Text style={styles.thText}>{t.name}</Text></View>)}
          </View>
          {rows.map((s, i) => (
            <View key={s.id} style={[styles.tr, i % 2 ? styles.trAlt : null, { alignItems: 'stretch' }]}>
              <View style={[styles.cell, styles.mSvc]}>
                <Text style={[styles.td, !s.is_active && { color: colors.muted }]}>{s.title}</Text>
                {!s.is_active ? <Text style={styles.offText}>OFF in Service Master</Text> : null}
              </View>
              {userTypes.map((t) => (
                <View key={t.id} style={[styles.cell, styles.mType, styles.mCell]}>
                  {cell(s, t).map((r) => (
                    <Pressable key={r.id} onPress={() => onEdit(r)} style={[styles.chip, r.txn_type === 'debit' ? styles.chipDebit : r.chain_type === 'chain' ? styles.chipChain : styles.chipSelf, !r.is_active && styles.chipOff]}>
                      <Text style={styles.chipText}>{chipLabel(r)}{r.operator ? ` · ${r.operator}` : ''}{!r.is_active ? ' (off)' : ''}</Text>
                      <Text style={styles.chipSub}>{r.plan_name} · {Number(r.min_amount)}–{Number(r.max_amount)}{r.specific_user ? ` · ${r.specific_user}` : ''}</Text>
                    </Pressable>
                  ))}
                  {gap(cell(s, t)) ? <Text style={styles.gapWarn}>{`⚠ Only ${gap(cell(s, t))} — other operators earn nothing`}</Text> : null}
                  {s.is_active ? <Pressable onPress={() => onAdd({ userTypeId: t.id, serviceId: s.id })} hitSlop={4}><Text style={styles.addLink}>+ Add</Text></Pressable> : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </Card>
  );
}

const styles = StyleSheet.create({
  gapBox: { padding: 14, gap: 6, borderRadius: radius.md, borderWidth: 1, borderColor: '#fcd34d', backgroundColor: '#fffbeb' },
  gapTitle: { fontWeight: '800', color: '#92400e', fontSize: 13.5 },
  gapLine: { color: colors.text, fontSize: 13, lineHeight: 19 },
  gapHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: radius.md, padding: 3 },
  tab: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.sm },
  tabOn: { backgroundColor: '#fff' },
  tabText: { color: colors.muted, fontWeight: '600', fontSize: 13.5 },
  tabTextOn: { color: colors.primary },
  matrixHint: { color: colors.muted, fontSize: 12.5, marginBottom: 12 },
  mSvc: { width: 220 }, mType: { width: 190 }, mCell: { gap: 6, alignItems: 'flex-start' },
  offText: { color: colors.danger, fontSize: 11, marginTop: 2 },
  chip: { borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 8, borderWidth: 1, alignSelf: 'stretch' },
  chipSelf: { backgroundColor: colors.successBg, borderColor: '#a7f3d0' },
  chipChain: { backgroundColor: colors.infoBg, borderColor: '#bfdbfe' },
  chipDebit: { backgroundColor: colors.warningBg, borderColor: '#fde68a' },
  chipOff: { opacity: 0.5 },
  chipText: { color: colors.text, fontSize: 12.5, fontWeight: '700' },
  chipSub: { color: colors.muted, fontSize: 11, marginTop: 1 },
  addLink: { color: colors.primary, fontSize: 12, fontWeight: '700', paddingVertical: 2 },
  gapWarn: { color: colors.warning, fontSize: 11.5, fontWeight: '600' },
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
