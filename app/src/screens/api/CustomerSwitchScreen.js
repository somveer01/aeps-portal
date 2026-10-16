import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Switch } from 'react-native';
import { Card, Alert, Select } from '../../components/UI';
import ActionIcon from '../../components/ActionIcon';
import DataGrid from '../../components/DataGrid';
import FormBar from '../../components/FormBar';
import UserPicker from '../../components/UserPicker';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { fmtDateTime } from '../../utils/dateTime';
import { s, Pager, Chip } from './apiStyles';

// Customer Switch: for ONE user (customer), the API each service goes through (else the Product Switch API) and
// whether the service is on for them. The on / off is the same per-user setting as Service Permissions, so the two
// screens always agree. The list shows every user who has something of their own.
const PAGE_SIZE = 10;
const DEFAULT = ''; // "use the Product Switch API"

export default function CustomerSwitchScreen() {
  const [view, setView] = useState('list');
  // list
  const [list, setList] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loadingList, setLoadingList] = useState(true); const [error, setError] = useState(null);
  // one user
  const [userId, setUserId] = useState(null);
  const [data, setData] = useState(null); const [rows, setRows] = useState([]); const [orig, setOrig] = useState({});
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [filter, setFilter] = useState('');

  const loadList = useCallback(async (opts = {}) => {
    setLoadingList(true); setError(null);
    try { const r = await api.customerSwitch.list({ q: opts.q ?? q, page: opts.page ?? page, pageSize: PAGE_SIZE }); setList(r.rows); setTotal(r.total); setPage(r.page); }
    catch (e) { setError(e.message); } finally { setLoadingList(false); }
  }, [q, page]);
  useEffect(() => { const t = setTimeout(() => loadList({ page: 1, q }), 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const openUser = async (id) => {
    if (!id) return;
    setUserId(id); setView('user'); setLoading(true); setFormError(null); setFilter('');
    try {
      const r = await api.customerSwitch.get(id);
      const form = r.rows.map((x) => ({ ...x, provider_id: x.provider_id || DEFAULT }));
      setData(r); setRows(form);
      setOrig(Object.fromEntries(form.map((x) => [x.service_id, { provider_id: x.provider_id, enabled: x.enabled }])));
    } catch (e) { setFormError(e.message); } finally { setLoading(false); }
  };
  const back = () => { setView('list'); setData(null); setUserId(null); loadList(); };

  const changed = useMemo(() => rows.filter((r) => orig[r.service_id] && (orig[r.service_id].provider_id !== r.provider_id || orig[r.service_id].enabled !== r.enabled)), [rows, orig]);
  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.service_id === id ? { ...r, ...patch } : r)));
  const save = async () => {
    if (!changed.length) return;
    setSaving(true); setFormError(null);
    try {
      await api.customerSwitch.save(userId, changed.map((r) => ({ serviceId: r.service_id, providerId: r.provider_id || null, enabled: r.enabled })));
      await openUser(userId);
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  if (view === 'user') {
    const u = data && data.user;
    const providers = (data && data.providers) || [];
    const nameOf = (id) => (providers.find((p) => p.id === id) || {}).name || '—';
    const shown = rows.filter((r) => !filter.trim() || r.title.toLowerCase().includes(filter.trim().toLowerCase()));
    return (
      <View style={{ gap: 16 }}>
        <FormBar heading={u ? `${u.full_name || u.username} (${u.user_code || u.username})` : 'Customer Switch'}
          saveTitle={changed.length ? `Save (${changed.length})` : 'Save'} onSave={save} saving={saving}
          onCancel={changed.length ? () => { setRows((rs) => rs.map((r) => ({ ...r, ...orig[r.service_id] }))); setFormError(null); } : undefined}
          backTitle="All Users" onBack={back} error={formError} />
        <Card>
          <View style={s.cardHead}>
            <View style={{ flexShrink: 1, flexBasis: 320, flexGrow: 1, gap: 2 }}>
              <Text style={s.cardTitle}>{u ? `${u.user_type_name || 'User'} · ${u.mobile || ''}` : 'Loading…'}</Text>
              <Text style={s.sub}>"Default" follows Product Switch. Pick an API only where this user must go through a different one, e.g. to try a new API with one retailer first.</Text>
            </View>
            <TextInput value={filter} onChangeText={setFilter} placeholder="Search service…" placeholderTextColor={colors.muted} style={s.search} />
          </View>
          {changed.length ? <Text style={[s.dirty, { marginBottom: 10 }]}>{changed.length} unsaved change(s)</Text> : null}
          <DataGrid
            rows={shown} loading={loading} rowKey={(r) => r.service_id} emptyText="No services."
            rowStyle={(r) => (changed.includes(r) ? { backgroundColor: '#fffbeb' } : null)}
            columns={[
              { key: 'title', title: 'Service', flex: 1, minWidth: 170, render: (r) => (
                <View style={{ gap: 2 }}>
                  <Text style={[s.td, { fontWeight: '600' }]}>{r.title}</Text>
                  <Text style={s.tdMuted}>{r.category_name || ''}</Text>
                </View>
              ) },
              { key: 'api', title: 'API for this user', width: 290, render: (r) => (
                <View style={{ width: '100%' }}>
                  <Select value={r.provider_id} searchable={false} onChange={(v) => setRow(r.service_id, { provider_id: v })}
                    options={[{ label: `Default (${r.default_provider_name || 'Mock'})`, value: DEFAULT },
                      ...providers.filter((p) => r.ready_provider_ids.includes(p.id) || p.id === r.provider_id).map((p) => ({ label: `${p.name}${p.is_active ? '' : ' - off'}`, value: p.id }))]} />
                </View>
              ) },
              { key: 'saved', title: 'Saved', width: 170, render: (r) => {
                const o = orig[r.service_id]; if (!o) return null;
                return o.provider_id ? <Chip text={nameOf(o.provider_id)} tone="success" /> : <Chip text="Default" tone="muted" />;
              } },
              { key: 'type_default', title: 'Type Default', width: 120, render: (r) => <Text style={s.tdMuted}>{r.type_default ? 'On' : 'Off'}</Text> },
              { key: 'status', title: 'On For User', width: 110, render: (r) => (
                <Switch value={!!r.enabled} onValueChange={(v) => setRow(r.service_id, { enabled: v })} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" />
              ) },
            ]}
          />
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <Card>
        <View style={s.grid}>
          <View style={s.field}>
            <UserPicker label="Choose a user" value={null} onChange={(id) => openUser(id)} placeholder="Search by login id, name or mobile…" />
            <Text style={s.help}>Opens that user's services: the API each one goes through and whether it is on for them.</Text>
          </View>
        </View>
      </Card>
      <Card>
        <View style={s.cardHead}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text style={s.cardTitle}>Users with their own settings</Text>
            <Text style={s.sub}>Users who have an API of their own for a service, or a service switched on / off just for them.</Text>
          </View>
          <View style={s.searchWrap}><Text style={s.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.muted} style={s.search} /></View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={list} loading={loadingList} emptyText="No user has settings of their own yet."
          columns={[
            { key: 'user', title: 'User', flex: 1, minWidth: 200, render: (r) => (
              <View style={{ gap: 2 }}>
                <Text style={[s.td, { fontWeight: '600' }]}>{r.full_name}</Text>
                <Text style={s.tdMuted}>{r.user_code}</Text>
              </View>
            ) },
            { key: 'user_type_name', title: 'User Type', width: 150 },
            { key: 'api_overrides', title: 'Own API', width: 110, render: (r) => <Text style={s.td}>{r.api_overrides}</Text> },
            { key: 'blocked', title: 'Switched Off', width: 120, render: (r) => <Text style={[s.td, r.blocked ? { color: colors.danger, fontWeight: '700' } : null]}>{r.blocked}</Text> },
            { key: 'extra_allowed', title: 'Extra On', width: 100, render: (r) => <Text style={s.td}>{r.extra_allowed}</Text> },
            { key: 'updated_at', title: 'Updated', width: 175, render: (r) => <Text style={s.tdMuted}>{r.updated_at ? fmtDateTime(r.updated_at) : '—'}</Text> },
            { key: 'action', title: 'Action', width: 80, render: (r) => <View style={s.actions}><ActionIcon name="edit" onPress={() => openUser(r.id)} /></View> },
          ]}
        />
        <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={(p) => loadList({ page: p })} />
      </Card>
    </View>
  );
}
