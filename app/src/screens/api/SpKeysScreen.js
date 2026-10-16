import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Switch } from 'react-native';
import { Card, Alert, Select } from '../../components/UI';
import DataGrid from '../../components/DataGrid';
import FormBar from '../../components/FormBar';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { fmtDateTime } from '../../utils/dateTime';
import { s, Chip, COMMISSION_TYPES } from './apiStyles';

// SP Keys & Commission: per API and service, the product code (SP key) we send to that API for each operator, and what
// the API pays us (% / FLAT) or charges us (Surcharge / Surcharge %). The "All operators" row covers every operator
// without its own row. An empty row (no SP key, value 0) is removed on save.
const toForm = (r) => ({ ...r, sp_key: r.sp_key || '', commission_value: String(Number(r.commission_value) || 0) });

export default function SpKeysScreen() {
  const [providers, setProviders] = useState([]);
  const [providerId, setProviderId] = useState('');
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [data, setData] = useState(null); // { provider, service, kind, rows }
  const [rows, setRows] = useState([]); const [orig, setOrig] = useState('[]');
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null); const [formError, setFormError] = useState(null);

  useEffect(() => {
    api.apiProviders.options().then((r) => {
      setProviders(r.rows || []);
      const first = (r.rows || []).find((p) => p.code !== 'MOCK') || (r.rows || [])[0];
      if (first) setProviderId(first.id);
    }).catch((e) => setError(e.message));
  }, []);

  const loadServices = (pid) => api.spKeys.services(pid).then((r) => setServices(r.rows || [])).catch((e) => setError(e.message));
  useEffect(() => { if (providerId) loadServices(providerId); setData(null); /* eslint-disable-next-line */ }, [providerId]);

  const load = async () => {
    if (!providerId || !serviceId) { setData(null); return; }
    setLoading(true); setError(null); setFormError(null);
    try {
      const r = await api.spKeys.get(providerId, serviceId);
      const form = r.rows.map(toForm);
      setData(r); setRows(form); setOrig(JSON.stringify(form));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [providerId, serviceId]);

  const dirty = JSON.stringify(rows) !== orig;
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const save = async () => {
    for (const r of rows) {
      const v = Number(r.commission_value || 0);
      if (!Number.isFinite(v) || v < 0) { setFormError(`Enter a valid value for ${r.operator || 'All operators'}.`); return; }
      if (r.commission_type.endsWith('percent') && v > 100) { setFormError(`A percentage cannot be above 100 (${r.operator || 'All operators'}).`); return; }
    }
    setSaving(true); setFormError(null);
    try {
      await api.spKeys.save({
        providerId, serviceId,
        rows: rows.map((r) => ({ operator: r.operator, spKey: r.sp_key.trim(), commissionType: r.commission_type, commissionValue: Number(r.commission_value || 0), isActive: r.is_active })),
      });
      await load(); loadServices(providerId);
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const providerOptions = providers.map((p) => ({ label: `${p.name} (${p.code})${p.is_active ? '' : ' - off'}`, value: p.id }));
  const serviceOptions = useMemo(() => services.map((x) => ({
    label: `${x.title}${x.category_name ? ` · ${x.category_name}` : ''}${x.mapped ? ` · ${x.mapped} key(s)` : ''}${x.is_active ? '' : ' (off)'}`, value: x.id,
  })), [services]);
  const p = data && data.provider;
  const opLabel = data && data.kind === 'mode' ? 'Mode' : 'Operator';

  return (
    <View style={{ gap: 16 }}>
      <Card>
        <View style={s.grid}>
          <View style={s.field}><Select label="API" value={providerId} options={providerOptions} onChange={(v) => { setProviderId(v); setServiceId(''); }} placeholder="-- Select API --" /></View>
          <View style={s.field}><Select label="Service" value={serviceId} options={serviceOptions} onChange={setServiceId} placeholder="-- Select Service --" /></View>
        </View>
        {error ? <View style={{ marginTop: 12 }}><Alert type="error">{error}</Alert></View> : null}
      </Card>

      {!serviceId ? (
        <Card><Text style={s.sub}>Choose an API and a service to see and edit its SP keys and commission, operator by operator.</Text></Card>
      ) : data ? (
        <>
          <FormBar heading={`${p.name} · ${data.service.title}`} saveTitle="Save" onSave={save} saving={saving}
            onCancel={dirty ? () => { setRows(JSON.parse(orig)); setFormError(null); } : undefined} error={formError} />
          <Card>
            <View style={s.info}>
              <Text style={s.infoText}>
                {p.needsSpKey
                  ? `${p.name} needs an SP key for every operator you use: fill the operator rows, or only "All operators" if the same key works for all. `
                  : `${p.name} is the mock API: SP keys are optional. `}
                % and FLAT are what the API pays us per transaction; Surcharge is what it charges us. The Admin Margin report uses these rates.
              </Text>
            </View>
            {dirty ? <Text style={[s.dirty, { marginTop: 10 }]}>Unsaved changes</Text> : null}
            <View style={{ marginTop: 12 }}>
              <DataGrid
                rows={rows} loading={loading} rowKey={(r) => r.operator || '__all'} emptyText="No operators."
                columns={[
                  { key: 'operator', title: opLabel, flex: 1, minWidth: 170, render: (r) => (
                    r.operator ? <Text style={[s.td, { fontWeight: '600' }]}>{r.operator}</Text> : <Chip text="All operators" tone="primary" />
                  ) },
                  { key: 'sp_key', title: 'SP Key / Product Code', width: 210, render: (r, i) => (
                    <TextInput value={r.sp_key} onChangeText={(v) => setRow(i, 'sp_key', v)} autoCapitalize="characters" placeholder={r.operator ? 'Uses All operators' : 'e.g. RA'} placeholderTextColor={colors.muted} style={[s.inputSm, { width: '100%' }]} />
                  ) },
                  { key: 'commission_type', title: 'Type', width: 230, render: (r, i) => (
                    <View style={{ width: '100%' }}><Select value={r.commission_type} options={COMMISSION_TYPES} onChange={(v) => setRow(i, 'commission_type', v)} searchable={false} /></View>
                  ) },
                  { key: 'commission_value', title: 'Value', width: 120, render: (r, i) => (
                    <TextInput value={r.commission_value} onChangeText={(v) => setRow(i, 'commission_value', v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted} style={[s.inputSm, { width: '100%' }]} />
                  ) },
                  { key: 'updated_at', title: 'Updated', width: 175, render: (r) => <Text style={s.tdMuted}>{r.updated_at ? fmtDateTime(r.updated_at) : 'Not set'}</Text> },
                  { key: 'status', title: 'Active', width: 90, render: (r, i) => (
                    <Switch value={!!r.is_active} onValueChange={(v) => setRow(i, 'is_active', v)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" />
                  ) },
                ]}
              />
            </View>
          </Card>
        </>
      ) : loading ? <Card><Text style={s.sub}>Loading…</Text></Card> : null}
    </View>
  );
}
