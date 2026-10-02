import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;

export default function CityMasterScreen() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [states, setStates] = useState([]);

  // add/edit modal
  const [view, setView] = useState('list');
  const [editing, setEditing] = useState(null);
  const [stateId, setStateId] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const p = opts.page ?? page;
      const query = opts.q ?? q;
      const res = await api.cities.list({ ...grid.params, q: query, page: p, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, grid.sort, grid.filters]);
  useGridReload(grid, () => load({ page: 1 }));

  useEffect(() => { load({ page: 1 }); api.states().then((r) => setStates(r.states)).catch(() => {}); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const openAdd = () => { setEditing(null); setName(''); setStateId(states[0]?.id ?? ''); setFormError(null); setView('form'); };
  const openEdit = (row) => { setEditing(row); setName(row.name); setStateId(row.state_id); setFormError(null); setView('form'); };

  const save = async () => {
    const trimmed = name.trim();
    if (!stateId) { setFormError('Please select a state.'); return; }
    if (trimmed.length < 2) { setFormError('City name must be at least 2 characters.'); return; }
    setSaving(true); setFormError(null);
    try {
      if (editing) await api.cities.update(editing.id, { stateId, name: trimmed });
      else await api.cities.create({ stateId, name: trimmed });
      setView('list');
      await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const stateOptions = states.map((s) => ({ label: s.name, value: s.id }));

  // compact page-number list around current page
  const pageNums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pageNums.push(i);

  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.formHeaderBar}>
          <Text style={styles.formHeading}>{editing ? 'Edit City' : 'New City'}</Text>
          <Button title="ALL CITIES" onPress={() => setView('list')} style={{ paddingHorizontal: 18 }} />
        </View>
        <Card>
          {formError ? <Alert type="error">{formError}</Alert> : null}
          <View style={styles.grid}>
            <View style={styles.field}><Select label="State *" value={stateId} options={stateOptions} onChange={setStateId} placeholder="Select a state" /></View>
            <View style={styles.field}><Text style={styles.label}>City Name *</Text>
              <TextInput value={name} onChangeText={setName} placeholder="e.g. Bengaluru" placeholderTextColor={colors.muted} style={styles.modalInput} onSubmitEditing={save} /></View>
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
      <View style={styles.actionBar}>
        <Button title="+ NEW CITY" onPress={openAdd} style={{ paddingHorizontal: 20 }} />
      </View>

      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All Cities</Text>
          <View style={styles.searchWrap}>
            <Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="State or city…" placeholderTextColor={colors.muted} style={styles.search} />
          </View>
        </View>

        {error ? <Alert type="error">{error}</Alert> : null}

        <DataGrid
          rows={rows} loading={loading} emptyText="No cities found."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (row, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'state', title: 'State', width: 220, render: (row) => <Text style={styles.td}>{row.state_name}</Text> },
            { key: 'name', title: 'City', flex: 1, minWidth: 200 },
            { key: 'action', title: 'Action', width: 110, sortable: false, filterable: false, render: (row) => (
              <View style={styles.actions}>
                <Pressable onPress={() => openEdit(row)} hitSlop={6}><Text style={{ color: colors.primary, fontSize: 16 }}>✏️</Text></Pressable>
              </View>
            ) },
          ]}
        />

        <View style={styles.pagination}>
          <Text style={styles.entries}>Showing {from} to {to} of {total} entries</Text>
          <View style={styles.pager}>
            <Pressable disabled={page <= 1} onPress={() => load({ page: page - 1 })} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}>
              <Text style={styles.pageBtnText}>Previous</Text>
            </Pressable>
            {pageNums.map((n) => (
              <Pressable key={n} onPress={() => load({ page: n })} style={[styles.pageBtn, n === page && styles.pageCurrent]}>
                <Text style={n === page ? { color: '#fff', fontWeight: '700' } : styles.pageBtnText}>{n}</Text>
              </Pressable>
            ))}
            <Pressable disabled={page >= totalPages} onPress={() => load({ page: page + 1 })} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}>
              <Text style={styles.pageBtnText}>Next</Text>
            </Pressable>
          </View>
        </View>
      </Card>

    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 14 },
  actionBar: { flexDirection: 'row', justifyContent: 'flex-end' },
  formHeaderBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  formHeading: { fontSize: 20, fontWeight: '700', color: colors.text },
  formActions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 12, marginTop: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14 },
  field: { flexGrow: 1, flexBasis: '46%', minWidth: 220, gap: 6 },
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
  colNo: { width: 60 },
  colState: { flex: 1, minWidth: 180 },
  colCity: { flex: 1, minWidth: 180 },
  colAction: { width: 90 },
  iconBtn: { padding: 2 },
  empty: { padding: 30, alignItems: 'center' },

  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { color: colors.text },
  pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 420, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
});
