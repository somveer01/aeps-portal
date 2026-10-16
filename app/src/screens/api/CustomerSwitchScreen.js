import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Switch } from 'react-native';
import { Card, Alert, Select } from '../../components/UI';
import ActionIcon from '../../components/ActionIcon';
import FormBar from '../../components/FormBar';
import UserPicker from '../../components/UserPicker';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { fmtDateTime } from '../../utils/dateTime';
import { s, Pager, Chip, CardGrid, ItemCard } from './apiStyles';

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
          <CardGrid loading={loading} empty="No services.">
            {shown.map((r) => {
              const o = orig[r.service_id] || {};
              return (
                <ItemCard key={r.service_id} changed={changed.includes(r)} off={!r.enabled}>
                  <View style={s.cardTop}>
                    <View style={{ flexShrink: 1, gap: 4 }}>
                      <Text style={s.cardName}>{r.title}</Text>
                      <Chip text={r.category_name || 'No category'} tone="muted" />
                    </View>
                    <View style={{ alignItems: 'center', gap: 2 }}>
                      <Switch value={!!r.enabled} onValueChange={(v) => setRow(r.service_id, { enabled: v })} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" />
                      <Text style={s.tdMuted}>{r.enabled ? 'On for user' : 'Off for user'}</Text>
                    </View>
                  </View>
                  <View style={{ gap: 6 }}>
                    <Text style={s.cardLabel}>API for this user</Text>
                    <Select value={r.provider_id} searchable={false} onChange={(v) => setRow(r.service_id, { provider_id: v })}
                      options={[{ label: `Default (${r.default_provider_name || 'Mock'})`, value: DEFAULT },
                        ...providers.filter((p) => r.ready_provider_ids.includes(p.id) || p.id === r.provider_id).map((p) => ({ label: `${p.name}${p.is_active ? '' : ' - off'}`, value: p.id }))]} />
                  </View>
                  <View style={s.cardFoot}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.tdMuted}>Saved:</Text>
                      {o.provider_id ? <Chip text={nameOf(o.provider_id)} tone="success" /> : <Chip text="Default" tone="muted" />}
                    </View>
                    <Text style={s.tdMuted}>Type default: {r.type_default ? 'On' : 'Off'}</Text>
                  </View>
                </ItemCard>
              );
            })}
          </CardGrid>
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
        <CardGrid loading={loadingList} empty="No user has settings of their own yet.">
          {list.map((r) => (
            <ItemCard key={r.id} onPress={() => openUser(r.id)}>
              <View style={s.cardTop}>
                <View style={{ flexShrink: 1, gap: 4 }}>
                  <Text style={s.cardName}>{r.full_name}</Text>
                  <Text style={s.tdMuted}>{r.user_code}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Chip text={r.user_type_name || 'User'} tone="primary" />
                  <ActionIcon name="edit" onPress={() => openUser(r.id)} />
                </View>
              </View>
              <View style={s.statRow}>
                <View style={s.stat}><Text style={s.statNum}>{r.api_overrides}</Text><Text style={s.statLbl}>Own API</Text></View>
                <View style={s.stat}><Text style={[s.statNum, r.blocked ? { color: colors.danger } : null]}>{r.blocked}</Text><Text style={s.statLbl}>Switched off</Text></View>
                <View style={s.stat}><Text style={s.statNum}>{r.extra_allowed}</Text><Text style={s.statLbl}>Extra on</Text></View>
              </View>
              <Text style={s.tdMuted}>Updated {r.updated_at ? fmtDateTime(r.updated_at) : '—'}</Text>
            </ItemCard>
          ))}
        </CardGrid>
        <Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={(p) => loadList({ page: p })} />
      </Card>
    </View>
  );
}
