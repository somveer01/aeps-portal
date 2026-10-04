import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, StatusBadge } from '../components/UI';
import { FioriPage, FioriPanel, FioriButton, FIORI } from '../components/Fiori';
import { api } from '../api/client';
import { colors, radius } from '../theme';
import { Pager, reportStyles } from './AccountHistoryScreen';
import DataGrid, { useGrid } from '../components/DataGrid';

// Modules → Service Permissions.
// A user may use a service when it is ON in Service Master AND (their own allow/block, else their
// user type's default). "By User Type" edits the defaults; "By Service" sets allow/block per user.
export default function ServicePermissionScreen() {
  const [tab, setTab] = useState('types');
  const [data, setData] = useState(null); // { services, userTypes, allowed }
  const [error, setError] = useState(null);

  const loadMatrix = useCallback(async () => {
    try { setData(await api.servicePermissions.matrix()); setError(null); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  return (
    <FioriPage>
      <View style={styles.tabs}>
        {[['types', 'By User Type'], ['service', 'By Service']].map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Alert type="info">A user can use a service only when it is ON in Service Master and allowed here. A user-level Allow / Block (By Service) beats the user type default.</Alert>
      <Alert>{error}</Alert>
      {!data ? <FioriPanel><ActivityIndicator color={colors.primary} /></FioriPanel>
        : tab === 'types' ? <TypeMatrix data={data} setData={setData} onError={setError} />
          : <ServiceUsers services={data.services} userTypes={data.userTypes} />}
    </FioriPage>
  );
}

function TypeMatrix({ data, setData, onError }) {
  const { services, userTypes, allowed } = data;
  const on = useMemo(() => new Set(allowed.map((a) => `${a.userTypeId}:${a.serviceId}`)), [allowed]);
  const [busy, setBusy] = useState(false);

  // Optimistic: flip locally, then save; on failure reload the truth.
  const save = async (body, nextAllowed) => {
    const before = data;
    setData({ ...data, allowed: nextAllowed });
    setBusy(true);
    try { await api.servicePermissions.setMatrix(body); onError(null); } catch (e) { setData(before); onError(e.message); } finally { setBusy(false); }
  };
  const cell = (t, s) => {
    const want = !on.has(`${t.id}:${s.id}`);
    const next = want ? [...allowed, { userTypeId: t.id, serviceId: s.id }] : allowed.filter((a) => !(a.userTypeId === t.id && a.serviceId === s.id));
    save({ userTypeId: t.id, serviceId: s.id, allowed: want }, next);
  };
  const column = (t) => {
    const want = !services.every((s) => on.has(`${t.id}:${s.id}`));
    const rest = allowed.filter((a) => a.userTypeId !== t.id);
    save({ userTypeId: t.id, allowed: want }, want ? [...rest, ...services.map((s) => ({ userTypeId: t.id, serviceId: s.id }))] : rest);
  };
  const row = (s) => {
    const want = !userTypes.every((t) => on.has(`${t.id}:${s.id}`));
    const rest = allowed.filter((a) => a.serviceId !== s.id);
    save({ serviceId: s.id, allowed: want }, want ? [...rest, ...userTypes.map((t) => ({ userTypeId: t.id, serviceId: s.id }))] : rest);
  };

  return (
    <FioriPanel>
      <Text style={styles.sub}>Default for every user of a type. Tick = the type may use the service. Click a column or row title to switch all.</Text>
      <ScrollView horizontal>
        <View style={{ minWidth: 260 + userTypes.length * 130 }}>
          <View style={[styles.tr, styles.th]}>
            <View style={[styles.cell, styles.cSvc]}><Text style={styles.thText}>Service</Text></View>
            {userTypes.map((t) => (
              <Pressable key={t.id} onPress={() => column(t)} disabled={busy} style={[styles.cell, styles.cType]}>
                <Text style={[styles.thText, { textAlign: 'center' }]}>{t.name}</Text>
                <Text style={styles.thHint}>all / none</Text>
              </Pressable>
            ))}
          </View>
          {services.map((s, i) => (
            <View key={s.id} style={[styles.tr, i % 2 === 1 && styles.trAlt]}>
              <Pressable onPress={() => row(s)} disabled={busy} style={[styles.cell, styles.cSvc]}>
                <Text style={[styles.td, !s.is_active && { color: colors.muted }]}>{s.title}</Text>
                {!s.is_active ? <Text style={styles.offText}>OFF in Service Master</Text> : null}
              </Pressable>
              {userTypes.map((t) => (
                <View key={t.id} style={[styles.cell, styles.cType]}>
                  <Tick checked={on.has(`${t.id}:${s.id}`)} onPress={() => cell(t, s)} disabled={busy} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </FioriPanel>
  );
}

const PAGE_SIZE = 20;
const STATUS = [{ label: 'All', value: '' }, { label: 'Allowed', value: 'allowed' }, { label: 'Blocked', value: 'blocked' }];

function ServiceUsers({ services, userTypes }) {
  const [serviceId, setServiceId] = useState(services[0] ? services[0].id : '');
  const [q, setQ] = useState(''); const [typeId, setTypeId] = useState(''); const [status, setStatus] = useState('');
  const [res, setRes] = useState(null);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState(new Set());
  const [msg, setMsg] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);

  const grid = useGrid(); // DataGrid; load() changes with it, so the [load] effect reloads
  const load = useCallback(async (p = 1) => {
    if (!serviceId) return;
    try {
      const r = await api.servicePermissions.users(serviceId, { q: q.trim(), userTypeId: typeId, status, ...grid.params, page: p, pageSize: PAGE_SIZE });
      setRes(r); setPage(p); setPicked(new Set()); setErr(null);
    } catch (e) { setErr(e.message); }
  }, [serviceId, q, typeId, status, grid.sort, grid.filters]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [load]);

  const rows = res ? res.rows : [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = async (mode) => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await api.servicePermissions.setUsers(serviceId, { userIds: [...picked], mode });
      setMsg(`${r.updated} user(s) set to ${mode === 'default' ? 'type default' : mode}.`);
      await load(page);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const svc = services.find((s) => String(s.id) === String(serviceId));
  const total = res ? res.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <FioriPanel>
      <View style={styles.grid}>
        <View style={styles.field}><Select label="Service" value={serviceId} options={services.map((s) => ({ label: s.is_active ? s.title : `${s.title} (OFF)`, value: s.id }))} onChange={setServiceId} /></View>
        <View style={styles.field}><Text style={styles.label}>Search</Text><TextInput value={q} onChangeText={setQ} placeholder="User ID / name / mobile" placeholderTextColor={colors.muted} style={styles.input} /></View>
        <View style={styles.field}><Select label="User Type" value={typeId} options={[{ label: 'All', value: '' }, ...userTypes.map((t) => ({ label: t.name, value: t.id }))]} onChange={setTypeId} /></View>
        <View style={styles.field}><Select label="Access" value={status} options={STATUS} onChange={setStatus} searchable={false} /></View>
      </View>
      {svc && !svc.is_active ? <View style={{ marginTop: 12 }}><Alert>{`${svc.title} is OFF in Service Master, so nobody can use it whatever is set here.`}</Alert></View> : null}
      <View style={styles.bulkBar}>
        <Pressable onPress={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))} style={styles.pickAll}><Tick checked={allPicked} /><Text style={styles.sub}>{allPicked ? 'Clear page' : 'Select page'}</Text></Pressable>
        <Text style={styles.sub}>{picked.size ? `${picked.size} selected` : 'Tick users, then:'}</Text>
        <FioriButton title="Allow" onPress={() => apply('allow')} disabled={!picked.size || busy} />
        <FioriButton title="Block" variant="default" onPress={() => apply('block')} disabled={!picked.size || busy} />
        <FioriButton title="Use type default" variant="transparent" onPress={() => apply('default')} disabled={!picked.size || busy} />
      </View>
      <Alert type="success">{msg}</Alert>
      <Alert>{err}</Alert>
      <DataGrid
        rows={rows} loading={!res} emptyText="No users found." onRowPress={(r) => toggle(r.id)}
        sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
        columns={[
          { key: 'pick', title: '✓', width: 56, sortable: false, filterable: false, render: (r) => <Tick checked={picked.has(r.id)} onPress={() => toggle(r.id)} /> },
          { key: 'user', title: 'User', flex: 1, minWidth: 240, render: (r) => <View><Text style={styles.td}>{r.user_code} · {r.name}</Text>{!r.is_active ? <Text style={styles.offText}>Account blocked</Text> : null}</View> },
          { key: 'user_type', title: 'User Type', width: 150, render: (r) => <Text style={styles.td}>{r.user_type_name}</Text> },
          { key: 'type_default', title: 'Type Default', width: 130, render: (r) => <StatusBadge label={r.type_default ? 'Allowed' : 'Not allowed'} tone={r.type_default ? 'info' : 'muted'} /> },
          { key: 'override', title: 'User Setting', width: 130, render: (r) => (r.override === null ? <Text style={styles.sub}>— default —</Text> : <StatusBadge label={r.override ? 'Allow' : 'Block'} tone={r.override ? 'success' : 'danger'} />) },
          { key: 'effective', title: 'Can Use', width: 120, render: (r) => <StatusBadge label={r.effective && svc && svc.is_active ? 'Yes' : 'No'} tone={r.effective && svc && svc.is_active ? 'success' : 'danger'} /> },
        ]}
      />
      <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
    </FioriPanel>
  );
}

function Tick({ checked, onPress, disabled, light }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || !onPress} hitSlop={6}
      style={[styles.box, light && styles.boxLight, checked && (light ? styles.boxOnLight : styles.boxOn)]}>
      {checked ? <Text style={[styles.tick, light && { color: colors.primary }]}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: FIORI.line, borderRadius: 8, paddingHorizontal: 8, paddingTop: 6 },
  tab: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: FIORI.blue },
  tabText: { color: FIORI.label, fontWeight: '600', fontSize: 13.5 },
  tabTextOn: { color: FIORI.blue },
  thHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, textAlign: 'center', marginTop: 2 },
  offText: { color: colors.danger, fontSize: 11, marginTop: 2 },
  cSvc: { width: 260 }, cType: { width: 130, alignItems: 'center' },
  cPick: { width: 50, alignItems: 'center' }, cUser: { flex: 1, minWidth: 240 }, cUType: { width: 150 }, cSt: { width: 125 },
  pickAll: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bulkBar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginVertical: 14 },
  box: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  boxLight: { borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'transparent' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  boxOnLight: { backgroundColor: '#fff', borderColor: '#fff' },
  tick: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
