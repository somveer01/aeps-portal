import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Card, Alert, Button, Select } from '../components/UI';
import ConfirmDialog from '../components/ConfirmDialog';
import { api } from '../api/client';
import { colors, radius } from '../theme';

// Commission Overview (admin): per service and operator - what the API pays the company, what each level of a sale chain (Super
// Distributor -> Distributor -> Retailer ...) is paid, and the company's margin, on a sample amount. Click a level to change its slab
// (the ordinary Commission Slots rules apply); the margin after the change is shown before saving.
const GST = 18;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (v) => `${Number(v) < 0 ? '-' : ''}₹${Math.abs(Number(v || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${Number(v || 0).toFixed(2)}%`;
const slabText = (c) => (c.commissionType === 'amount' ? `₹${Number(c.value)}` : `${Number(c.value)}%`);
// What one slab pays on `amount` (the engine's computeAmounts): commission, then GST on top.
const calc = (type, value, amount) => {
  const v = Number(value); const commission = round2(type === 'amount' ? v : (amount * v) / 100);
  const gst = Math.round(commission * GST) / 100;
  return { commission, gst, net: round2(commission + gst) };
};
const COL = { name: 230, provider: 140, level: 140, paid: 120, margin: 160 };
const STATUS = { over: { text: 'More than the API pays', bg: '#fee2e2', fg: '#991b1b' }, gap: { text: 'A level earns nothing', bg: '#fef3c7', fg: '#92400e' } };

function Tag({ text, bg, fg }) { return <View style={[st.tag, { backgroundColor: bg }]}><Text style={[st.tagText, { color: fg }]} numberOfLines={1}>{text}</Text></View>; }

export default function CommissionOverviewScreen() {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [typeId, setTypeId] = useState(''); const [amountText, setAmountText] = useState('1000'); const [amount, setAmount] = useState(1000);
  const [planSel, setPlanSel] = useState({}); // typeId -> planId
  const [q, setQ] = useState(''); const [onlyProblems, setOnlyProblems] = useState(false);
  const [open, setOpen] = useState(new Set());
  const [edit, setEdit] = useState(null); // { serviceId, operator, idx, type, value, chain }
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  const [toRemove, setToRemove] = useState(null); const [removing, setRemoving] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (overrides = {}) => {
    const mine = ++seq.current; // ignore an older answer that arrives late
    setLoading(true); setError(null);
    try {
      const plansParam = Object.entries(overrides.planSel || planSel).map(([t, p]) => `${t}:${p}`).join(',');
      const res = await api.commissionOverview.get({ amount: overrides.amount ?? amount, typeId: overrides.typeId ?? typeId, plans: plansParam });
      if (mine !== seq.current) return;
      setData(res);
      if (!typeId && res.bottomTypeId) setTypeId(res.bottomTypeId);
      setPlanSel((p) => { const n = { ...p }; res.chain.forEach((c) => { if (c.planId && !n[c.typeId]) n[c.typeId] = c.planId; }); return n; });
    } catch (e) { if (mine === seq.current) setError(e.message); } finally { if (mine === seq.current) setLoading(false); }
    /* eslint-disable-next-line */
  }, [amount, typeId, planSel]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const applyAmount = () => {
    const n = Number(amountText);
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amountText.trim()) || !(n > 0)) { setError('Enter a sample amount greater than 0 (up to 2 decimals).'); return; }
    setAmount(n); setEdit(null); load({ amount: n });
  };
  const chooseType = (v) => { setTypeId(v); setPlanSel({}); setEdit(null); load({ typeId: v, planSel: {} }); };
  const choosePlan = (tid, pid) => { const n = { ...planSel, [tid]: pid }; setPlanSel(n); setEdit(null); load({ planSel: n }); };

  const typeOptions = useMemo(() => (data ? data.types.map((t) => ({ label: t.name, value: t.id })) : []), [data]);
  const services = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    return data.services.filter((s) => (!t || s.service.toLowerCase().includes(t) || s.rows.some((r) => r.operator.toLowerCase().includes(t)))
      && (!onlyProblems || s.rows.some((r) => r.status === 'over' || r.status === 'gap')));
  }, [data, q, onlyProblems]);
  const problemCount = useMemo(() => (data ? data.services.reduce((n, s) => n + s.rows.filter((r) => r.status === 'over' || r.status === 'gap').length, 0) : 0), [data]);

  const toggle = (id) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const startEdit = (svc, row, idx) => {
    const cell = row.cells[idx]; const bottom = idx === data.chain.length - 1;
    if (!data.chain[idx].planId) return;
    setFormError(null);
    setEdit({ serviceId: svc.serviceId, operator: row.operator, idx, type: cell.commissionType || 'percentage', value: cell.slotId ? String(cell.value) : '', chain: cell.chainType || (bottom ? 'self' : 'chain') });
  };

  // The row being edited, and the margin it would have after the change (shown before saving).
  const editing = useMemo(() => {
    if (!edit || !data) return null;
    const svc = data.services.find((s) => s.serviceId === edit.serviceId); const row = svc && svc.rows.find((r) => r.operator === edit.operator);
    if (!row) return null;
    const cell = row.cells[edit.idx]; const bottom = edit.idx === data.chain.length - 1;
    const v = Number(edit.value); const valid = edit.value !== '' && Number.isFinite(v) && v >= 0 && !(edit.type === 'percentage' && v > 100);
    const counts = bottom || edit.chain === 'chain'; // an upline is paid by chain slabs only
    const newNet = valid && counts ? calc(edit.type, v, amount).net : 0;
    const total = round2(row.totalPaid - (cell.net || 0) + newNet);
    const margin = round2(row.provider.amount + row.charge - total);
    return { svc, row, cell, bottom, valid, counts, total, margin, marginPct: round2((margin / amount) * 100), type: data.chain[edit.idx] };
  }, [edit, data, amount]);

  const save = async () => {
    if (!editing || !editing.valid) { setFormError('Enter a number: a percentage up to 100, or a rupee amount.'); return; }
    const { cell, row, svc, type, bottom } = editing;
    setSaving(true); setFormError(null);
    try {
      if (cell.slotId && !cell.inherited) {
        await api.commissionSlots.update(cell.slotId, { commissionType: edit.type, value: Number(edit.value), chainType: bottom ? edit.chain : 'chain' });
      } else {
        await api.commissionSlots.create({
          userTypeId: type.typeId, serviceId: svc.serviceId, planId: type.planId, operator: row.operator, commissionType: edit.type, value: Number(edit.value),
          chainType: bottom ? edit.chain : 'chain', txnType: 'credit', minAmount: cell.minAmount || 1, maxAmount: cell.maxAmount || 100000,
        });
      }
      setEdit(null); await load();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };
  const remove = async () => {
    setRemoving(true);
    try { await api.commissionSlots.remove(toRemove); setToRemove(null); setEdit(null); await load(); } catch (e) { setFormError(e.message); setToRemove(null); } finally { setRemoving(false); }
  };

  const chain = data ? data.chain : [];
  const tableWidth = COL.name + COL.provider + chain.length * COL.level + COL.paid + COL.margin;

  const renderRow = (svc, row, { header, isOpen, canOpen }) => {
    const label = header ? svc.service : row.label;
    const status = STATUS[row.status];
    return (
      <View key={`${svc.serviceId}:${row.operator}`}>
        <Pressable disabled={!header || !canOpen} onPress={() => toggle(svc.serviceId)} style={({ hovered }) => [st.row, header ? st.rowHead : st.rowSub, hovered && header && canOpen && st.rowHover, header && !svc.isActive && { opacity: 0.6 }]}>
          <View style={[st.cName, !header && { paddingLeft: 38 }]}>
            {header ? (canOpen ? <View style={[st.chev, isOpen && st.chevOpen]}><Text style={[st.chevText, isOpen && { color: colors.onPrimary }]}>{isOpen ? '▾' : '▸'}</Text></View> : <View style={st.chevSpace} />) : null}
            <View style={{ flexShrink: 1 }}>
              <Text style={header ? st.svcName : st.opName} numberOfLines={1}>{label}</Text>
              {header ? <Text style={st.sub} numberOfLines={1}>{svc.category || ''}{!svc.isActive ? ' · switched off' : ''}{canOpen ? ` · ${svc.rows.length - 1} operators` : ''}</Text> : null}
              {header ? <Text style={st.sub}>All operators</Text> : null}
            </View>
          </View>

          <View style={[st.cell, { width: COL.provider }]}>
            <Text style={[st.big, row.provider.amount < 0 && { color: colors.danger }]}>{money(row.provider.amount)}</Text>
            <Text style={st.sub}>{pct(row.provider.percent)} · {row.provider.source === 'sp_key' ? `SP key${row.provider.apiName ? ` (${row.provider.apiName})` : ''}` : (row.provider.source === 'service' ? 'Service Master' : 'no rate set')}</Text>
          </View>

          {row.cells.map((c, i) => {
            const active = edit && edit.serviceId === svc.serviceId && edit.operator === row.operator && edit.idx === i;
            const noPlan = !chain[i].planId; const bottom = i === chain.length - 1;
            return (
              <Pressable key={chain[i].typeId} onPress={() => startEdit(svc, row, i)} disabled={noPlan} style={({ hovered }) => [st.cell, st.cellBtn, { width: COL.level }, hovered && st.cellHover, active && st.cellActive]}>
                {c.slotId ? (
                  <>
                    <Text style={[st.big, c.inherited && { color: colors.muted }]}>{slabText(c)} <Text style={st.chainTag}>{c.chainType === 'chain' ? 'Chain' : 'Self'}</Text></Text>
                    <Text style={st.sub}>{money(c.net)}{c.inherited ? ' · from all' : ''}{c.others ? ` · +${c.others} more` : ''}</Text>
                  </>
                ) : (
                  <Text style={[st.sub, !bottom && { color: '#b45309' }]}>{noPlan ? 'no plan' : (bottom ? '— set' : 'earns nothing · set')}</Text>
                )}
              </Pressable>
            );
          })}

          <View style={[st.cell, { width: COL.paid }]}>
            <Text style={st.big}>{money(row.totalPaid)}</Text>
            <Text style={st.sub}>{pct(row.totalPaidPercent)} incl. GST</Text>
          </View>
          <View style={[st.cell, { width: COL.margin }]}>
            <Text style={[st.big, { color: row.margin < 0 ? colors.danger : colors.success }]}>{money(row.margin)} <Text style={st.sub}>· {pct(row.marginPercent)}</Text></Text>
            {status ? <Tag text={status.text} bg={status.bg} fg={status.fg} /> : (row.charge ? <Text style={st.sub}>incl. charge {money(row.charge)}</Text> : null)}
          </View>
        </Pressable>

        {editing && edit.serviceId === svc.serviceId && edit.operator === row.operator ? (
          <View style={st.editor}>
            <Text style={st.editTitle}>{editing.type.name} · {editing.type.planName} · {svc.service} · {row.label}</Text>
            {editing.cell.inherited ? <Text style={st.note}>This level uses the "All operators" slab. Saving creates a slab only for {row.label}.</Text> : null}
            <View style={st.editRow}>
              <View style={st.seg}>
                {[['percentage', '%'], ['amount', '₹']].map(([k, l]) => (
                  <Pressable key={k} onPress={() => setEdit((e) => ({ ...e, type: k }))} style={[st.segBtn, edit.type === k && st.segOn]}><Text style={[st.segText, edit.type === k && { color: colors.onPrimary }]}>{l}</Text></Pressable>
                ))}
              </View>
              <TextInput value={edit.value} onChangeText={(v) => setEdit((e) => ({ ...e, value: v }))} keyboardType="numeric" placeholder={edit.type === 'amount' ? 'Rupees per transaction' : 'Percent of the amount'} placeholderTextColor={colors.muted} style={st.input} autoFocus />
              {editing.bottom ? (
                <View style={st.seg}>
                  {[['self', 'Self'], ['chain', 'Chain']].map(([k, l]) => (
                    <Pressable key={k} onPress={() => setEdit((e) => ({ ...e, chain: k }))} style={[st.segBtn, edit.chain === k && st.segOn]}><Text style={[st.segText, edit.chain === k && { color: colors.onPrimary }]}>{l}</Text></Pressable>
                  ))}
                </View>
              ) : <Text style={st.sub}>Chain slab (a level above is paid only by chain slabs)</Text>}
            </View>
            <Text style={[st.preview, editing.margin < 0 && { color: colors.danger }]}>
              {editing.valid ? `After this change: paid ${money(editing.total)} · margin ${money(editing.margin)} (${pct(editing.marginPct)})${editing.margin < 0 ? ' - more than the API pays, so the levels above would be cut' : ''}` : 'Enter the new value to see the margin.'}
            </Text>
            {formError ? <Alert type="error">{formError}</Alert> : null}
            <View style={st.editRow}>
              <Button title="Save" onPress={save} loading={saving} style={st.btn} />
              <Button title="Cancel" variant="ghost" onPress={() => { setEdit(null); setFormError(null); }} style={st.btn} />
              {editing.cell.slotId && !editing.cell.inherited ? <Button title="Remove slab" variant="ghost" onPress={() => setToRemove(editing.cell.slotId)} style={st.btn} /> : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      <Card>
        <Text style={st.title}>Commission Overview</Text>
        <Text style={st.lead}>For every service and operator: what the API pays the company, what each level is paid (commission + GST) and what is left as the company's margin. Click a level to change its slab.</Text>

        <View style={st.controls}>
          <View style={st.ctl}><Text style={st.label}>Sale done by</Text><Select value={typeId} options={typeOptions} onChange={chooseType} placeholder="Choose a type" searchable={false} /></View>
          <View style={st.ctl}>
            <Text style={st.label}>Sample amount (₹)</Text>
            <View style={st.amountRow}>
              <TextInput value={amountText} onChangeText={setAmountText} onSubmitEditing={applyAmount} onBlur={applyAmount} keyboardType="numeric" style={[st.input, { flex: 1, minWidth: 90 }]} />
              <Button title="Apply" variant="ghost" onPress={applyAmount} style={st.btn} />
            </View>
          </View>
          {chain.filter((c) => c.plans.length > 1).map((c) => (
            <View key={c.typeId} style={st.ctl}><Text style={st.label}>{c.name} plan</Text><Select value={c.planId} options={c.plans.map((p) => ({ label: p.name, value: p.id }))} onChange={(v) => choosePlan(c.typeId, v)} searchable={false} /></View>
          ))}
          <View style={[st.ctl, { flexGrow: 2 }]}><Text style={st.label}>Search</Text><TextInput value={q} onChangeText={setQ} placeholder="Service or operator" placeholderTextColor={colors.muted} style={st.input} /></View>
        </View>

        <View style={st.bar}>
          <Pressable onPress={() => setOnlyProblems((v) => !v)} style={[st.pill, onlyProblems && st.pillOn]}><Text style={[st.pillText, onlyProblems && { color: colors.onPrimary }]}>Needs attention: {problemCount}</Text></Pressable>
          <View style={{ flex: 1 }} />
          <Button title="Expand all" variant="ghost" onPress={() => setOpen(new Set(services.filter((s) => s.rows.length > 1).map((s) => s.serviceId)))} style={st.btn} />
          <Button title="Collapse all" variant="ghost" onPress={() => setOpen(new Set())} style={st.btn} />
          <Button title="Reload" variant="ghost" onPress={() => load()} style={st.btn} />
        </View>

        {error ? <Alert type="error">{error}</Alert> : null}
        {loading && !data ? <View style={st.empty}><ActivityIndicator color={colors.primary} /></View> : null}

        {data ? (
          <ScrollView horizontal showsHorizontalScrollIndicator style={st.scroll}>
            <View style={{ width: tableWidth }}>
              <View style={st.head}>
                <Text style={[st.hText, { width: COL.name }]}>SERVICE / OPERATOR</Text>
                <Text style={[st.hText, { width: COL.provider }]}>API PAYS US</Text>
                {chain.map((c) => <Text key={c.typeId} style={[st.hText, { width: COL.level }]} numberOfLines={1}>{c.name.toUpperCase()} GETS</Text>)}
                <Text style={[st.hText, { width: COL.paid }]}>TOTAL PAID</Text>
                <Text style={[st.hText, { width: COL.margin }]}>COMPANY MARGIN</Text>
              </View>
              {services.length === 0 ? <View style={st.empty}><Text style={st.sub}>Nothing matches.</Text></View> : null}
              {services.map((svc) => {
                const head = svc.rows[0]; const canOpen = svc.rows.length > 1; const isOpen = open.has(svc.serviceId);
                return (
                  <View key={svc.serviceId} style={st.block}>
                    {renderRow(svc, head, { header: true, isOpen, canOpen })}
                    {isOpen ? svc.rows.slice(1).map((r) => renderRow(svc, r, { header: false })) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : null}
        <Text style={st.foot}>Margin = what the API pays + service charge collected − everything paid to the levels (each share is commission + {GST}% GST). The API rate is the SP key of the API the service uses, else the Service Master rate. A level above the one that did the sale is paid only by a "Chain" slab.</Text>
      </Card>

      <ConfirmDialog visible={!!toRemove} title="Remove this slab?" message="The slab stops applying from now on. Past commission entries are not changed." confirmText="Remove" loading={removing} onConfirm={remove} onCancel={() => setToRemove(null)} />
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  lead: { fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 4, marginBottom: 16 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  ctl: { flexGrow: 1, flexBasis: 170, minWidth: 150, maxWidth: 360, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  amountRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, minHeight: 48, fontSize: 16, color: colors.text, backgroundColor: '#fff', outlineStyle: 'none' },
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontWeight: '700', color: colors.text, fontSize: 14 },
  btn: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 14 },

  scroll: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  head: { flexDirection: 'row', backgroundColor: '#f8fafc', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  hText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: colors.muted, paddingHorizontal: 12 },
  block: { borderBottomWidth: 1, borderBottomColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#fff' },
  rowHead: { backgroundColor: '#fff' },
  rowSub: { backgroundColor: '#fafcff', borderTopWidth: 1, borderTopColor: '#eef2f7' },
  rowHover: { backgroundColor: '#f8fafc' },
  cName: { width: COL.name, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 12 },
  cell: { paddingVertical: 14, paddingHorizontal: 12, justifyContent: 'center', gap: 3 },
  cellBtn: { borderLeftWidth: 1, borderLeftColor: '#eef2f7' },
  cellHover: { backgroundColor: colors.primarySoft },
  cellActive: { backgroundColor: colors.primarySoft, borderBottomWidth: 3, borderBottomColor: colors.primary },
  svcName: { fontSize: 17, fontWeight: '800', color: colors.text },
  opName: { fontSize: 15, fontWeight: '700', color: colors.text },
  big: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12.5, color: colors.muted },
  chainTag: { fontSize: 11, fontWeight: '700', color: colors.primary },
  chev: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  chevOpen: { backgroundColor: colors.primary },
  chevText: { fontSize: 15, fontWeight: '800', color: colors.primary },
  chevSpace: { width: 28 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 12, fontWeight: '700' },

  editor: { backgroundColor: '#fffbeb', borderTopWidth: 1, borderTopColor: '#fde68a', padding: 16, gap: 10 },
  editTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  note: { fontSize: 13, color: '#92400e' },
  editRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  segBtn: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  segOn: { backgroundColor: colors.primary },
  segText: { fontWeight: '800', color: colors.text },
  preview: { fontSize: 15, fontWeight: '700', color: colors.success },
  foot: { fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 14 },
  empty: { padding: 28, alignItems: 'center' },
});
