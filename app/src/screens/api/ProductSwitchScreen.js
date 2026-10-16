import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Switch } from 'react-native';
import { Card, Alert, Select } from '../../components/UI';
import DataGrid from '../../components/DataGrid';
import FormBar from '../../components/FormBar';
import ConfirmDialog from '../../components/ConfirmDialog';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { fmtDateTime } from '../../utils/dateTime';
import { s, Chip } from './apiStyles';

// Product Switch: which API each service (product) goes through, and the service on / off (the same switch as in
// Service Master). An API is offered for a service only once it has an SP key for it (the mock API needs none).
// Changes are kept on screen until Save; switching a service off asks first.
export default function ProductSwitchScreen() {
  const [rows, setRows] = useState([]); const [orig, setOrig] = useState({});
  const [providers, setProviders] = useState([]); const [defaultId, setDefaultId] = useState(null);
  const [categories, setCategories] = useState([]); const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null); const [formError, setFormError] = useState(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.productSwitch.list({ q: q.trim(), categoryId });
      const list = r.rows.map((x) => ({ ...x, provider_id: x.provider_id || r.defaultProviderId }));
      setRows(list); setProviders(r.providers || []); setDefaultId(r.defaultProviderId);
      setOrig(Object.fromEntries(list.map((x) => [x.service_id, { provider_id: x.provider_id, is_active: x.is_active }])));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { api.serviceCategories.list({ pageSize: 100 }).then((r) => setCategories(r.rows || [])).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, categoryId]);

  const changed = useMemo(() => rows.filter((r) => orig[r.service_id] && (orig[r.service_id].provider_id !== r.provider_id || orig[r.service_id].is_active !== r.is_active)), [rows, orig]);
  const turningOff = changed.filter((r) => !r.is_active && orig[r.service_id].is_active);
  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.service_id === id ? { ...r, ...patch } : r)));

  const doSave = async () => {
    setSaving(true); setFormError(null);
    try {
      await api.productSwitch.save(changed.map((r) => ({
        serviceId: r.service_id, providerId: r.provider_id === defaultId ? null : r.provider_id, isActive: r.is_active,
      })));
      await load();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };
  const save = () => { if (!changed.length) return; if (turningOff.length) setConfirmOff(true); else doSave(); };

  const nameOf = (id) => (providers.find((p) => p.id === id) || {}).name || '—';
  const optionsFor = (r) => providers
    .filter((p) => r.ready_provider_ids.includes(p.id) || p.id === r.provider_id)
    .map((p) => ({ label: `${p.name}${p.id === defaultId ? ' (default)' : ''}${p.is_active ? '' : ' - off'}`, value: p.id }));

  return (
    <View style={{ gap: 16 }}>
      <FormBar heading="Product Switch" saveTitle={changed.length ? `Save (${changed.length})` : 'Save'} onSave={save} saving={saving}
        onCancel={changed.length ? () => { setRows((rs) => rs.map((r) => ({ ...r, ...orig[r.service_id] }))); setFormError(null); } : undefined} error={formError} />
      <Card>
        <View style={s.cardHead}>
          <View style={{ flexShrink: 1, flexBasis: 320, flexGrow: 1, gap: 2 }}>
            <Text style={s.cardTitle}>Which API each service uses</Text>
            <Text style={s.sub}>A service with no API of its own runs on the default (Mock) API. Need a new API in the list? Add its SP key in SP Keys & Commission first.</Text>
          </View>
          <View style={[s.searchWrap, { flexGrow: 1, justifyContent: 'flex-end', maxWidth: '100%' }]}>
            <View style={{ flexGrow: 1, flexBasis: 170, maxWidth: 260 }}><Select value={categoryId} options={[{ label: 'All categories', value: '' }, ...categories.map((c) => ({ label: c.name, value: c.id }))]} onChange={setCategoryId} placeholder="All categories" searchable={false} /></View>
            <TextInput value={q} onChangeText={setQ} placeholder="Search service…" placeholderTextColor={colors.muted} style={[s.search, { minHeight: 48, flexGrow: 1, flexBasis: 170, minWidth: 0, maxWidth: 300 }]} />
          </View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        {changed.length ? <Text style={[s.dirty, { marginBottom: 10 }]}>{changed.length} unsaved change(s)</Text> : null}
        <DataGrid
          rows={rows} loading={loading} rowKey={(r) => r.service_id} emptyText="No services found."
          rowStyle={(r) => (changed.includes(r) ? { backgroundColor: '#fffbeb' } : null)}
          columns={[
            { key: 'title', title: 'Service', flex: 1, minWidth: 180, render: (r) => <Text style={[s.td, { fontWeight: '600' }]}>{r.title}</Text> },
            { key: 'category_name', title: 'Category', width: 150, render: (r) => <Text style={s.tdMuted}>{r.category_name || '—'}</Text> },
            { key: 'api', title: 'API', width: 280, render: (r) => (
              <View style={{ width: '100%' }}><Select value={r.provider_id} options={optionsFor(r)} onChange={(v) => setRow(r.service_id, { provider_id: v })} searchable={false} /></View>
            ) },
            { key: 'now', title: 'Saved API', width: 170, render: (r) => {
              const o = orig[r.service_id]; if (!o) return null;
              return <Chip text={nameOf(o.provider_id)} tone={o.provider_id === defaultId ? 'muted' : 'success'} />;
            } },
            { key: 'updated_at', title: 'Updated', width: 175, render: (r) => <Text style={s.tdMuted}>{r.updated_at ? fmtDateTime(r.updated_at) : '—'}</Text> },
            { key: 'status', title: 'Service On', width: 100, render: (r) => (
              <Switch value={!!r.is_active} onValueChange={(v) => setRow(r.service_id, { is_active: v })} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" />
            ) },
          ]}
        />
      </Card>
      <ConfirmDialog visible={confirmOff} title="Switch off services?" confirmText="Save and switch off"
        message={`${turningOff.map((r) => r.title).join(', ')} will stop for every user until switched on again (same as the Service Master switch).`}
        loading={saving} onConfirm={async () => { setConfirmOff(false); await doSave(); }} onCancel={() => setConfirmOff(false)} />
    </View>
  );
}
