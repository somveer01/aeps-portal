import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Switch } from 'react-native';
import { Card, Button, Alert, Select } from '../../components/UI';
import ActionIcon from '../../components/ActionIcon';
import DataGrid, { useGrid, useGridReload } from '../../components/DataGrid';
import FormBar from '../../components/FormBar';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { fmtDateTime } from '../../utils/dateTime';
import { s, Pager, Chip, ExternalLink, isWebUrl } from './apiStyles';

// API Configuration: the external APIs the portal can send transactions to (name, code, how it is connected,
// endpoint, username, password, token / key, callback secret). Tokens and passwords are never shown again after
// saving - only "••••1234" for a token and "Saved" for a password. The endpoint is a link that opens the partner's page.
const PAGE_SIZE = 10;
const EMPTY = { name: '', code: '', adapter: 'custom', baseUrl: '', username: '', password: '', token: '', callbackSecret: '', description: '', active: true };

export default function ApiConfigurationScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [adapters, setAdapters] = useState([]);
  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);
  const [toOff, setToOff] = useState(null); // switching off an API that services still use asks first
  const [testing, setTesting] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const grid = useGrid();
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const res = await api.apiProviders.list({ ...grid.params, q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page); setAdapters(res.adapters || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, grid.sort, grid.filters]);
  useGridReload(grid, () => load({ page: 1 }));
  useEffect(() => { load({ page: 1 }); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const isMock = editing && editing.code === 'MOCK';
  const openAdd = () => { setEditing(null); setF(EMPTY); setFormError(null); setView('form'); };
  const openEdit = (r) => {
    setEditing(r);
    setF({ name: r.name, code: r.code, adapter: r.adapter, baseUrl: r.base_url || '', username: r.username || '', password: '', token: '', callbackSecret: '', description: r.description || '', active: r.is_active });
    setFormError(null); setView('form');
  };

  const save = async () => {
    if (f.name.trim().length < 2) { setFormError('Enter the API name.'); return; }
    if (!/^[A-Za-z0-9_]{2,40}$/.test(f.code.trim())) { setFormError('Code: 2-40 letters, digits or _ (e.g. PAYSPRINT).'); return; }
    if (f.baseUrl.trim() && !/^https?:\/\//i.test(f.baseUrl.trim())) { setFormError('Endpoint URL must start with http:// or https://'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = {
        name: f.name.trim(), code: f.code.trim().toUpperCase(), adapter: f.adapter, baseUrl: f.baseUrl.trim(), username: f.username.trim(),
        description: f.description.trim(), isActive: f.active,
      };
      // Empty password / token / secret on edit = keep the saved one.
      if (f.password) body.password = f.password;
      if (f.token.trim()) body.token = f.token.trim();
      if (f.callbackSecret.trim()) body.callbackSecret = f.callbackSecret.trim();
      if (editing) await api.apiProviders.update(editing.id, body); else await api.apiProviders.create(body);
      setView('list'); await load({ page: editing ? page : 1 });
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const applyStatus = async (row, value) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: value } : r)));
    try { await api.apiProviders.update(row.id, { isActive: value }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); }
  };
  const toggleStatus = (row) => {
    if (row.is_active && Number(row.services_routed) > 0) { setToOff(row); return; }
    applyStatus(row, !row.is_active);
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.apiProviders.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); }
    catch (e) { setToDelete(null); } finally { setDeleting(false); }
  };
  const testConnection = async (row) => {
    setTesting(row.id);
    try {
      const r = await api.apiProviders.test(row.id);
      const text = `${row.name}: ${r.message}${r.balance != null ? ` Balance ₹${Number(r.balance).toFixed(2)}.` : ''}`;
      if (r.ok) toast.success(text); else toast.warning(text);
    } catch (e) { toast.error(`${row.name}: ${e.message}`); } finally { setTesting(null); }
  };

  const adapterLabel = (key) => (adapters.find((a) => a.key === key) || {}).label || key;

  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <FormBar heading={editing ? `Edit API: ${editing.name}` : 'Add New API'} saveTitle={editing ? 'Save' : 'Create'} onSave={save} saving={saving}
          onCancel={() => setView('list')} backTitle="All APIs" onBack={() => setView('list')} error={formError} />
        <Card>
          <View style={s.grid}>
            <View style={s.field}><Text style={s.label}>API Name *</Text>
              <TextInput value={f.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Recharge API (Partner A)" placeholderTextColor={colors.muted} style={s.input} /></View>
            <View style={s.field}><Text style={s.label}>Code *</Text>
              <TextInput value={f.code} onChangeText={(v) => set('code', v.toUpperCase())} editable={!isMock} autoCapitalize="characters" placeholder="e.g. PARTNERA" placeholderTextColor={colors.muted} style={[s.input, isMock && { opacity: 0.6 }]} />
              <Text style={s.help}>Short unique name. Used in the callback URL: /api/provider-callback/{f.code.trim().toUpperCase() || 'CODE'}</Text></View>
            <View style={s.field}>
              {isMock ? (<><Text style={s.label}>Connection</Text><TextInput value={adapterLabel('mock')} editable={false} style={[s.input, { opacity: 0.6 }]} /></>) : (
                <Select label="Connection *" value={f.adapter} options={adapters.filter((a) => a.key !== 'mock' || f.adapter === 'mock').map((a) => ({ label: a.label, value: a.key }))} onChange={(v) => set('adapter', v)} searchable={false} />
              )}
              <Text style={s.help}>The code that talks to this API. Until it is written for a new partner, choose "Integration pending": the API can be set up now and goes live once the connection is added.</Text></View>
            <View style={s.field}><Text style={s.label}>Endpoint URL</Text>
              <TextInput value={f.baseUrl} onChangeText={(v) => set('baseUrl', v)} autoCapitalize="none" placeholder="https://api.partner.example/v1" placeholderTextColor={colors.muted} style={s.input} />
              {isWebUrl(f.baseUrl) ? <ExternalLink url={f.baseUrl.trim()}>Open this address in a new tab ↗</ExternalLink> : null}</View>
            <View style={s.field}><Text style={s.label}>Username / Member ID</Text>
              <TextInput value={f.username} onChangeText={(v) => set('username', v)} autoCapitalize="none" placeholder="Given by the API partner" placeholderTextColor={colors.muted} style={s.input} /></View>
            <View style={s.field}><Text style={s.label}>Password</Text>
              <TextInput value={f.password} onChangeText={(v) => set('password', v)} secureTextEntry autoCapitalize="none" autoComplete="off" placeholder={editing && editing.has_password ? 'Saved. Leave empty to keep it' : 'Password for the username'} placeholderTextColor={colors.muted} style={s.input} />
              <Text style={s.help}>Stored encrypted. It is never shown again.</Text></View>
            <View style={s.field}><Text style={s.label}>Token / API Key</Text>
              <TextInput value={f.token} onChangeText={(v) => set('token', v)} secureTextEntry autoCapitalize="none" placeholder={editing && editing.has_token ? `Saved (${editing.token_masked}). Leave empty to keep it` : 'Paste the token / key'} placeholderTextColor={colors.muted} style={s.input} />
              <Text style={s.help}>Stored encrypted. It is never shown again; only the last 4 characters.</Text></View>
            <View style={s.field}><Text style={s.label}>Callback Secret</Text>
              <TextInput value={f.callbackSecret} onChangeText={(v) => set('callbackSecret', v)} secureTextEntry autoCapitalize="none" placeholder={editing && editing.has_callback_secret ? 'Saved. Leave empty to keep it' : 'Shared secret for status callbacks'} placeholderTextColor={colors.muted} style={s.input} />
              <Text style={s.help}>The partner signs its status callbacks with this, so nobody else can mark a transaction success or failed.</Text></View>
            <View style={[s.field, s.switchField]}><Text style={s.label}>Active</Text>
              <Switch value={f.active} disabled={isMock} onValueChange={(v) => set('active', v)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
            <View style={s.fieldWide}><Text style={s.label}>Description</Text>
              <TextInput value={f.description} onChangeText={(v) => set('description', v)} multiline placeholder="What this API is used for, support contact ..." placeholderTextColor={colors.muted} style={[s.input, s.textarea]} /></View>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={s.actionBar}><Button title="+ Add New API" onPress={openAdd} style={{ paddingHorizontal: 20 }} /></View>
      <Card>
        <View style={s.cardHead}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text style={s.cardTitle}>All APIs</Text>
            <Text style={s.sub}>Set up each API here, then add its SP keys and choose which service uses it in Product Switch.</Text>
          </View>
          <View style={s.searchWrap}><Text style={s.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.muted} style={s.search} /></View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No APIs found."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'name', title: 'API Name / Code', flex: 1, minWidth: 200, render: (r) => (
              <View style={{ gap: 3 }}>
                <Text style={[s.td, { fontWeight: '700' }]}>{r.name}</Text>
                <Text style={s.mono}>{r.code}</Text>
                <Text style={s.tdMuted}>{r.code === 'MOCK' ? 'Default for services with no API' : `${r.services_routed} service(s) · ${r.sp_keys} SP key(s)`}</Text>
              </View>
            ) },
            { key: 'adapter', title: 'Connection', width: 150, render: (r) => <Chip text={r.adapter === 'mock' ? 'Mock' : r.adapter === 'custom' ? 'Integration pending' : r.adapter} tone={r.adapter === 'mock' ? 'muted' : r.adapter === 'custom' ? 'warning' : 'success'} /> },
            { key: 'base_url', title: 'Endpoint / Username', flex: 1, minWidth: 200, render: (r) => (
              <View style={{ gap: 2 }}>
                {r.base_url ? <ExternalLink url={r.base_url} /> : <Text style={s.td}>—</Text>}
                <Text style={s.tdMuted} numberOfLines={1}>{r.username ? `User: ${r.username}${r.has_password ? ' · password saved' : ' · no password'}` : 'No username'}</Text>
              </View>
            ) },
            { key: 'token', title: 'Token', width: 100, sortable: false, filterable: false, render: (r) => <Text style={s.mono}>{r.token_masked || '—'}</Text> },
            { key: 'status', title: 'Status', width: 80, render: (r) => <Switch value={!!r.is_active} disabled={r.code === 'MOCK'} onValueChange={() => toggleStatus(r)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /> },
            { key: 'updated_at', title: 'Updated', width: 175, render: (r) => <Text style={s.tdMuted}>{fmtDateTime(r.updated_at)}</Text> },
            { key: 'action', title: 'Action', width: 120, sortable: false, filterable: false, render: (r) => (
              <View style={s.actions}>
                <ActionIcon name="test" onPress={() => testConnection(r)} disabled={testing === r.id} />
                <ActionIcon name="edit" onPress={() => openEdit(r)} />
                {r.code !== 'MOCK' ? <ActionIcon name="delete" onPress={() => setToDelete(r)} /> : null}
              </View>
            ) },
          ]}
        />
        <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={(p) => load({ page: p })} />
      </Card>

      <ConfirmDialog visible={!!toDelete} title="Delete API"
        message={toDelete ? `Delete ${toDelete.name} (${toDelete.code}) and its SP keys? An API that already has transactions cannot be deleted; switch it off instead.` : ''}
        loading={deleting} onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
      <ConfirmDialog visible={!!toOff} title="Switch off this API?" confirmText="Switch Off"
        message={toOff ? `${toOff.services_routed} service(s) use ${toOff.name} in Product Switch. While it is off, those services (and users switched to it) stop working until you move them to another API or switch it on again.` : ''}
        onConfirm={() => { const r = toOff; setToOff(null); applyStatus(r, false); }} onCancel={() => setToOff(null)} />
    </View>
  );
}
