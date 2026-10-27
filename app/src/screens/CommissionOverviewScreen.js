import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Card, Alert, Button, Select } from '../components/UI';
import ConfirmDialog from '../components/ConfirmDialog';
import UserPicker from '../components/UserPicker';
import CommissionTable from '../components/commission/CommissionTable';
import SlabEditor from '../components/commission/SlabEditor';
import { api } from '../api/client';
import { colors, radius } from '../theme';
import { GST, round2, money, pct, calcSlab, validSlabValue } from '../utils/commissionMath';

// Commission Overview (admin): per service and operator - what the API pays the company, what each level of a sale chain is paid and the
// company's margin, on a sample amount. Two ways to look: "By type" (a user type and the types above it, one plan each) and "By user" (one
// user and the real chain above him, with his own slabs, his package and what he earns from his downline). Click a level to change its
// slab (the ordinary Commission Slots rules apply); the margin after the change is shown before saving. The table and the editor are
// shared components (components/commission), the numbers come from GET /api/commission-overview.
export default function CommissionOverviewScreen() {
  const [mode, setMode] = useState('type'); // 'type' | 'user'
  const [userId, setUserId] = useState('');
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [typeId, setTypeId] = useState(''); const [amountText, setAmountText] = useState('1000'); const [amount, setAmount] = useState(1000);
  const [planSel, setPlanSel] = useState({}); // typeId -> planId (by type)
  const [q, setQ] = useState(''); const [onlyProblems, setOnlyProblems] = useState(false);
  const [open, setOpen] = useState(new Set());
  const [edit, setEdit] = useState(null); // { serviceId, operator, key, idx, up, scope, type, value, chain }
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toRemove, setToRemove] = useState(null); const [removing, setRemoving] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (o = {}) => {
    const m = o.mode ?? mode; const uid = o.userId ?? userId;
    if (m === 'user' && !uid) { setData(null); setLoading(false); return; }
    const mine = ++seq.current; // ignore an older answer that arrives late
    setLoading(true); setError(null);
    try {
      const params = { amount: o.amount ?? amount };
      if (m === 'user') params.userId = uid;
      else { params.typeId = o.typeId ?? typeId; params.plans = Object.entries(o.planSel || planSel).map(([t, p]) => `${t}:${p}`).join(','); }
      const res = await api.commissionOverview.get(params);
      if (mine !== seq.current) return;
      setData(res);
      if (m === 'type') {
        if (!typeId && res.bottomTypeId) setTypeId(res.bottomTypeId);
        setPlanSel((p) => { const n = { ...p }; res.chain.forEach((c) => { if (c.planId && !n[c.typeId]) n[c.typeId] = c.planId; }); return n; });
      }
    } catch (e) { if (mine === seq.current) { setError(e.message); setData(null); } } finally { if (mine === seq.current) setLoading(false); }
  }, [mode, userId, amount, typeId, planSel]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const applyAmount = () => {
    const n = Number(amountText);
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amountText.trim()) || !(n > 0)) { setError('Enter a sample amount greater than 0 (up to 2 decimals).'); return; }
    setAmount(n); setEdit(null); load({ amount: n });
  };
  const chooseMode = (m) => { if (m === mode) return; setMode(m); setEdit(null); setOpen(new Set()); load({ mode: m }); };
  const chooseUser = (id) => { setUserId(id || ''); setEdit(null); load({ userId: id || '' }); };
  const chooseType = (v) => { setTypeId(v); setPlanSel({}); setEdit(null); load({ typeId: v, planSel: {} }); };
  const choosePlan = (tid, pid) => { const n = { ...planSel, [tid]: pid }; setPlanSel(n); setEdit(null); load({ planSel: n }); };

  const typeOptions = useMemo(() => (data && data.types ? data.types.map((t) => ({ label: t.name, value: t.id })) : []), [data]);
  const services = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    return data.services.filter((s) => (!t || s.service.toLowerCase().includes(t) || s.rows.some((r) => r.operator.toLowerCase().includes(t)))
      && (!onlyProblems || s.rows.some((r) => r.status === 'over' || r.status === 'gap')));
  }, [data, q, onlyProblems]);
  const problemCount = useMemo(() => (data ? data.services.reduce((n, s) => n + s.rows.filter((r) => r.status === 'over' || r.status === 'gap').length, 0) : 0), [data]);
  const toggle = (id) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const chain = data ? data.chain : [];
  const last = chain.length - 1;
  const userMode = data && data.mode === 'user';
  const levels = chain.map((c) => ({ key: c.key, title: userMode ? c.userCode : c.typeName, sub: userMode ? `${c.typeName}${c.planName ? ` · ${c.planName}` : ''}` : (c.planName || 'no plan'), hasPlan: !!c.planId }));
  const extra = userMode ? { title: `${data.user.userCode} from downline`, sub: 'his chain slab' } : null;

  // ── editing ───────────────────────────────────────────────────────────────────────────────────────
  const rowOf = (e) => { const svc = data && data.services.find((s) => s.serviceId === e.serviceId); return svc ? { svc, row: svc.rows.find((r) => r.operator === e.operator) } : {}; };
  // Which slab a choice of scope would change: his own (user) or the type's (the one underneath his own, or the one shown).
  const targetOf = (cell, scope) => {
    if (scope === 'user') return cell.scope === 'user' ? cell : null;
    return cell.scope === 'user' ? (cell.base || null) : (cell.slotId ? cell : null);
  };
  const seedOf = (cell, scope, bottom) => {
    const t = targetOf(cell, scope) || (scope === 'user' && cell.slotId ? cell : null);
    return { type: t ? t.commissionType : 'percentage', value: t ? String(t.value) : '', chain: t ? t.chainType : (bottom ? 'self' : 'chain') };
  };
  const startEdit = (svc, row, idx) => {
    const up = idx === 'up'; const col = chain[up ? last : idx]; const cell = up ? row.asUpline : row.cells[idx];
    if (!col.planId) { setError(`${userMode ? col.userCode : col.typeName} has no plan. Give a plan first (Users Manager / Plan Master).`); return; }
    const bottom = !up && idx === last; const scope = userMode ? 'user' : null;
    setFormError(null); setError(null);
    setEdit({ serviceId: svc.serviceId, operator: row.operator, key: col.key, idx: up ? last : idx, up, scope, bottom, ...seedOf(cell, scope, bottom) });
  };

  const editing = useMemo(() => {
    if (!edit || !data) return null;
    const { svc, row } = rowOf(edit); if (!row) return null;
    const col = chain[edit.idx]; const cell = edit.up ? row.asUpline : row.cells[edit.idx];
    const valid = validSlabValue(edit.type, edit.value);
    const underneath = userMode && edit.scope === 'type' && cell.scope === 'user'; // his own slab hides the type slab for him
    const counts = edit.up ? false : (edit.bottom || edit.chain === 'chain');
    const oldNet = edit.up ? 0 : (cell.net || 0);
    const newNet = valid && counts && !underneath ? calcSlab(edit.type, edit.value, amount).net : oldNet;
    const total = round2(row.totalPaid - oldNet + (valid && counts && !underneath ? newNet : oldNet));
    const margin = round2(row.provider.amount + row.charge - total);
    let text;
    if (!valid) text = 'Enter the new value to see the margin.';
    else if (edit.up) text = `This is paid when someone below ${col.userCode || col.typeName} sells. The margin of his own sale does not change.`;
    else if (underneath) text = `${col.userCode} has his own slab, which applies first. This changes everyone else of ${col.typeName}${col.planName ? ` · ${col.planName}` : ''}, not him.`;
    else text = `After this change: paid ${money(total)} · margin ${money(margin)} (${pct(round2((margin / amount) * 100))})${margin < 0 ? ' - more than the API pays, so the levels above would be cut' : ''}`;
    return { svc, row, col, cell, valid, target: targetOf(cell, edit.scope), margin, text, negative: valid && !edit.up && !underneath && margin < 0 };
  }, [edit, data, amount, chain, userMode]);

  const save = async () => {
    if (!editing || !editing.valid) { setFormError('Enter a number: a percentage up to 100, or a rupee amount.'); return; }
    const { svc, row, col, cell, target } = editing;
    const chainType = edit.up || !edit.bottom ? 'chain' : edit.chain;
    setSaving(true); setFormError(null);
    try {
      if (target && target.slotId && !target.inherited) {
        await api.commissionSlots.update(target.slotId, { commissionType: edit.type, value: Number(edit.value), chainType });
      } else {
        const range = target || cell;
        await api.commissionSlots.create({
          userTypeId: col.typeId, serviceId: svc.serviceId, planId: col.planId, operator: row.operator, commissionType: edit.type, value: Number(edit.value), chainType,
          txnType: 'credit', minAmount: range.minAmount || 1, maxAmount: range.maxAmount || 100000, ...(edit.scope === 'user' ? { specificUser: col.userCode } : {}),
        });
      }
      setEdit(null); await load();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };
  const remove = async () => {
    setRemoving(true);
    try { await api.commissionSlots.remove(toRemove); setToRemove(null); setEdit(null); await load(); } catch (e) { setFormError(e.message); setToRemove(null); } finally { setRemoving(false); }
  };

  const renderEditor = () => {
    if (!editing) return null;
    const { col, cell, target } = editing;
    const who = userMode ? `${col.userCode} (${col.typeName})` : col.typeName;
    const notes = [];
    if (cell.inherited && !edit.scope) notes.push('This level uses the "All operators" slab. Saving creates a slab only for this operator.');
    if (userMode && edit.scope === 'user') notes.push(`A slab only for ${col.userCode}. Everyone else of this type keeps the type slab.${cell.scope === 'user' ? '' : ' Saving creates it.'}`);
    if (userMode && edit.scope === 'type' && target && target.inherited) notes.push('The type uses the "All operators" slab. Saving creates a slab only for this operator.');
    if (userMode && edit.scope === 'type' && !target) notes.push('The type has no slab here yet. Saving creates one for everyone of this type and plan.');
    const canRemove = target && target.slotId && !target.inherited;
    return (
      <SlabEditor
        title={`${who} · ${col.planName || ''} · ${editing.svc.service} · ${editing.row.label}${edit.up ? ' · from downline sales' : ''}`}
        notes={notes}
        scopes={userMode ? [{ key: 'user', label: `Only ${col.userCode}` }, { key: 'type', label: `Everyone of ${col.typeName}${col.planName ? ` · ${col.planName}` : ''}` }] : null}
        scope={edit.scope} onScope={(k) => setEdit((e) => ({ ...e, scope: k, ...seedOf(cell, k, e.bottom) }))}
        type={edit.type} value={edit.value} chain={edit.chain} onChange={(p) => setEdit((e) => ({ ...e, ...p }))}
        showChain={edit.bottom} chainText={edit.up ? 'Chain slab (paid on sales by users below)' : 'Chain slab (a level above is paid only by chain slabs)'}
        preview={{ text: editing.text, negative: editing.negative }} error={formError} saving={saving}
        onSave={save} onCancel={() => { setEdit(null); setFormError(null); }}
        onRemove={canRemove ? () => setToRemove(target.slotId) : null}
        removeLabel={edit.scope === 'user' ? `Remove ${col.userCode}'s slab` : 'Remove slab'}
      />
    );
  };

  return (
    <View style={{ gap: 16 }}>
      <Card>
        <Text style={st.title}>Commission Overview</Text>
        <Text style={st.lead}>For every service and operator: what the API pays the company, what each level is paid (commission + GST) and what is left as the company's margin. Click a level to change its slab.</Text>

        <View style={st.modes}>
          {[['type', 'By type'], ['user', 'By user']].map(([k, l]) => (
            <Pressable key={k} onPress={() => chooseMode(k)} style={[st.mode, mode === k && st.modeOn]}><Text style={[st.modeText, mode === k && { color: colors.onPrimary }]}>{l}</Text></Pressable>
          ))}
        </View>

        <View style={st.controls}>
          {mode === 'type' ? (
            <View style={st.ctl}><Text style={st.label}>Sale done by</Text><Select value={typeId} options={typeOptions} onChange={chooseType} placeholder="Choose a type" searchable={false} /></View>
          ) : (
            <View style={[st.ctl, { flexBasis: 260 }]}><Text style={st.label}>User</Text><UserPicker value={userId} onChange={chooseUser} valueKey="id" placeholder="Search by user ID, name or mobile" /></View>
          )}
          <View style={st.ctl}>
            <Text style={st.label}>Sample amount (₹)</Text>
            <View style={st.amountRow}>
              <TextInput value={amountText} onChangeText={setAmountText} onSubmitEditing={applyAmount} onBlur={applyAmount} keyboardType="numeric" style={[st.input, { flex: 1, minWidth: 90 }]} />
              <Button title="Apply" variant="ghost" onPress={applyAmount} style={st.btn} />
            </View>
          </View>
          {mode === 'type' ? chain.filter((c) => c.plans.length > 1).map((c) => (
            <View key={c.typeId} style={st.ctl}><Text style={st.label}>{c.typeName} plan</Text><Select value={c.planId} options={c.plans.map((p) => ({ label: p.name, value: p.id }))} onChange={(v) => choosePlan(c.typeId, v)} searchable={false} /></View>
          )) : null}
          <View style={[st.ctl, { flexGrow: 2 }]}><Text style={st.label}>Search</Text><TextInput value={q} onChangeText={setQ} placeholder="Service or operator" placeholderTextColor={colors.muted} style={st.input} /></View>
        </View>

        {userMode ? (
          <Text style={st.who}>
            {data.user.userCode} · {data.user.name} · {data.user.typeName}{data.user.planName ? ` · ${data.user.planName}` : ' · no plan'}. The columns are the real chain above him, top first; his own slab beats the type slab, as in a real sale.
          </Text>
        ) : null}

        <View style={st.bar}>
          <Pressable onPress={() => setOnlyProblems((v) => !v)} style={[st.pill, onlyProblems && st.pillOn]}><Text style={[st.pillText, onlyProblems && { color: colors.onPrimary }]}>Needs attention: {problemCount}</Text></Pressable>
          <View style={{ flex: 1 }} />
          <Button title="Expand all" variant="ghost" onPress={() => setOpen(new Set(services.filter((s) => s.rows.length > 1).map((s) => s.serviceId)))} style={st.btn} />
          <Button title="Collapse all" variant="ghost" onPress={() => setOpen(new Set())} style={st.btn} />
          <Button title="Reload" variant="ghost" onPress={() => load()} style={st.btn} />
        </View>

        {error ? <Alert type="error">{error}</Alert> : null}
        {loading && !data ? <View style={st.empty}><ActivityIndicator color={colors.primary} /></View> : null}
        {mode === 'user' && !userId ? <View style={st.empty}><Text style={st.hint}>Choose a user to see his commission on every service.</Text></View> : null}

        {data ? (
          <CommissionTable levels={levels} extra={extra} services={services} open={open} active={edit}
            onToggle={toggle} onCell={startEdit} renderEditor={renderEditor} />
        ) : null}
        <Text style={st.foot}>
          Margin = what the API pays + service charge collected − everything paid to the levels (each share is commission + {GST}% GST). The API rate is the SP key of the API the service uses, else the Service Master rate.
          A level above the one that did the sale is paid only by a "Chain" slab. A commission package moves part of a share between a user and his parent; it is shown on the slab, and the total never changes.
        </Text>
      </Card>

      <ConfirmDialog visible={!!toRemove} title="Remove this slab?" message="The slab stops applying from now on. Past commission entries are not changed." confirmText="Remove" loading={removing} onConfirm={remove} onCancel={() => setToRemove(null)} />
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  lead: { fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 4, marginBottom: 14 },
  modes: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden', marginBottom: 14 },
  mode: { paddingHorizontal: 20, paddingVertical: 11, backgroundColor: '#fff' },
  modeOn: { backgroundColor: colors.primary },
  modeText: { fontWeight: '800', color: colors.text, fontSize: 15 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  ctl: { flexGrow: 1, flexBasis: 170, minWidth: 150, maxWidth: 380, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  amountRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, minHeight: 48, fontSize: 16, color: colors.text, backgroundColor: '#fff', outlineStyle: 'none' },
  who: { fontSize: 14, lineHeight: 20, color: colors.text, backgroundColor: colors.primarySoft, padding: 12, borderRadius: radius.sm, marginBottom: 12 },
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontWeight: '700', color: colors.text, fontSize: 14 },
  btn: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 14 },
  hint: { fontSize: 15, color: colors.muted },
  foot: { fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 14 },
  empty: { padding: 28, alignItems: 'center' },
});
