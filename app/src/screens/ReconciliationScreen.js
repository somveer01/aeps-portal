import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, ScrollView, Pressable, Modal } from 'react-native';
import { Card, Button, Alert, DateField, StatusBadge, Select } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';
import { Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const money = (v) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);
const dt = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const yesterday = () => { const y = new Date(Date.now() - 86400000); return `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`; };
const TYPE_TEXT = {
  STATUS_MISMATCH: 'Status differs',
  AMOUNT_MISMATCH: 'Amount differs',
  MISSING_AT_PROVIDER: 'Not in provider report',
  MISSING_AT_OURS: 'Only in provider report',
  AUTO_FINALIZED: 'Pending → settled',
};
const STATE_OPTIONS = [{ label: 'Open', value: 'open' }, { label: 'Resolved', value: 'resolved' }, { label: 'Settled automatically', value: 'auto' }, { label: 'All', value: '' }];
const RUN_COLS = [110, 90, 90, 100, 110, 100, 140, 110];
const ITEM_COLS = [170, 170, 150, 180, 180, 110, 220];

// Admin: compare one day of our transactions with the provider's report. The scheduler
// runs yesterday automatically; pending ones the provider settled are settled here too.
export default function ReconciliationScreen() {
  const [runs, setRuns] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [notice, setNotice] = useState(null);
  const [date, setDate] = useState(yesterday()); const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError(null);
    try { const r = await api.reconciliation.runs({ page: p, pageSize: PAGE_SIZE }); setRuns(r.rows); setTotal(r.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(1); }, [load]);

  const runNow = async () => {
    setRunning(true); setError(null); setNotice(null);
    try {
      const r = await api.reconciliation.run(date);
      setNotice(`${date}: ${r.total} transactions checked, ${r.matched} matched, ${r.mismatched} to review, ${r.autoFixed} pending settled.`);
      await load(1);
    } catch (e) { setError(e.message); } finally { setRunning(false); }
  };

  if (open) return <RunItems run={open} onBack={() => { setOpen(null); load(page); }} />;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);
  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>Reconciliation</Text>
      <Text style={styles.note}>Each run matches one day of transactions against the provider's report. Pending transactions the provider has settled are settled automatically; every other difference stays open until you resolve it (raise a dispute or make an adjustment, then note what you did). Yesterday runs automatically every night.</Text>
      {notice ? <Alert type="success">{notice}</Alert> : null}
      {error ? <Alert type="error">{error}</Alert> : null}
      <Card>
        <View style={styles.runRow}>
          <View style={{ minWidth: 220 }}><DateField label="Date" value={date} onChange={setDate} /></View>
          <Button title="Run reconciliation" onPress={runNow} loading={running} disabled={!date} />
        </View>
      </Card>
      <Card>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: RUN_COLS.reduce((a, b) => a + b, 0), flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              {['Date', 'Checked', 'Matched', 'To review', 'Open items', 'Settled', 'Ran', 'Action'].map((h, i) => (
                <Text key={h} numberOfLines={1} style={[styles.cell, styles.thText, { width: RUN_COLS[i] }]}>{h}</Text>
              ))}
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : runs.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No runs yet. Pick a date and run one.</Text></View>
                : runs.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.td, { width: RUN_COLS[0], fontWeight: '700' }]}>{r.run_date}</Text>
                    <Text style={[styles.cell, styles.td, { width: RUN_COLS[1] }]}>{r.total}</Text>
                    <Text style={[styles.cell, styles.td, { width: RUN_COLS[2] }]}>{r.matched}</Text>
                    <Text style={[styles.cell, styles.td, { width: RUN_COLS[3] }]}>{r.mismatched}</Text>
                    <View style={[styles.cell, { width: RUN_COLS[4] }]}>
                      {r.status === 'failed' ? <StatusBadge label="Run failed" tone="danger" />
                        : <StatusBadge label={r.open_items ? `${r.open_items} open` : 'All clear'} tone={r.open_items ? 'warning' : 'success'} />}
                    </View>
                    <Text style={[styles.cell, styles.td, { width: RUN_COLS[5] }]}>{r.auto_fixed}</Text>
                    <View style={[styles.cell, { width: RUN_COLS[6] }]}><Text style={styles.td}>{dt(r.started_at)}</Text><Text style={styles.sub}>{r.run_by_name || 'Scheduler'}</Text></View>
                    <View style={[styles.cell, { width: RUN_COLS[7] }]}>
                      <Pressable onPress={() => setOpen(r)} style={styles.btn}><Text style={styles.btnText}>View</Text></Pressable>
                    </View>
                  </View>
                ))}
          </View>
        </ScrollView>
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

function RunItems({ run, onBack }) {
  const [state, setState] = useState('open');
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [resolve, setResolve] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows((await api.reconciliation.items(run.id, { state })).rows); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [run.id, state]);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>Reconciliation — {run.run_date}</Text>
        <Button title="ALL RUNS" onPress={onBack} />
      </View>
      {run.error ? <Alert type="error">{`This run failed: ${run.error}`}</Alert> : null}
      <Card>
        <View style={{ maxWidth: 260, marginBottom: 12 }}><Select label="Show" value={state} options={STATE_OPTIONS} onChange={setState} searchable={false} /></View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: ITEM_COLS.reduce((a, b) => a + b, 0), flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              {['Difference', 'Our ref', 'User', 'Ours', 'Provider', 'State', 'Note / action'].map((h, i) => (
                <Text key={h} numberOfLines={1} style={[styles.cell, styles.thText, { width: ITEM_COLS[i] }]}>{h}</Text>
              ))}
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>{state === 'open' ? 'Nothing left to review for this day.' : 'No items.'}</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.td, { width: ITEM_COLS[0], fontWeight: '700' }]}>{TYPE_TEXT[r.type] || r.type}</Text>
                    <View style={[styles.cell, { width: ITEM_COLS[1] }]}><Text style={styles.td} numberOfLines={1}>{r.client_ref || '—'}</Text>{r.service ? <Text style={styles.sub}>{r.service}</Text> : null}</View>
                    <View style={[styles.cell, { width: ITEM_COLS[2] }]}><Text style={styles.td} numberOfLines={1}>{r.user_name || '—'}</Text>{r.user_code ? <Text style={styles.sub}>{r.user_code}</Text> : null}</View>
                    <Text style={[styles.cell, styles.td, { width: ITEM_COLS[3] }]}>{r.our_status ? `${r.our_status} · ${money(r.our_amount)}` : 'not recorded'}</Text>
                    <Text style={[styles.cell, styles.td, { width: ITEM_COLS[4] }]}>{r.provider_status ? `${r.provider_status} · ${money(r.provider_amount)}` : 'not in report'}</Text>
                    <View style={[styles.cell, { width: ITEM_COLS[5] }]}><StatusBadge label={r.state} tone={r.state === 'open' ? 'warning' : 'success'} /></View>
                    <View style={[styles.cell, { width: ITEM_COLS[6] }]}>
                      {r.state === 'open'
                        ? <Pressable onPress={() => setResolve(r)} style={styles.btn}><Text style={styles.btnText}>Resolve</Text></Pressable>
                        : <Text style={styles.td} numberOfLines={3}>{r.note || '—'}{r.resolved_by_name ? ` (${r.resolved_by_name})` : ''}</Text>}
                    </View>
                  </View>
                ))}
          </View>
        </ScrollView>
      </Card>
      <ResolveModal item={resolve} onClose={() => setResolve(null)} onDone={() => { setResolve(null); load(); }} />
    </View>
  );
}

function ResolveModal({ item, onClose, onDone }) {
  const [note, setNote] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState(null);
  useEffect(() => { setNote(''); setError(null); }, [item]);
  if (!item) return null;
  const submit = async () => {
    setError(null);
    if (note.trim().length < 3) { setError('Write how this was resolved.'); return; }
    setSaving(true);
    try { await api.reconciliation.resolve(item.id, note.trim()); onDone(); } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Resolve: {TYPE_TEXT[item.type] || item.type}</Text>
          <Text style={styles.para}>{item.client_ref || '—'} · ours {item.our_status || '—'} {money(item.our_amount)} · provider {item.provider_status || '—'} {money(item.provider_amount)}</Text>
          <Text style={styles.para}>Resolving only closes this item. Any money correction (refund, debit, adjustment) is done separately, for example through Fund Transfer.</Text>
          {error ? <Alert type="error">{error}</Alert> : null}
          <TextInput value={note} onChangeText={setNote} multiline placeholder="e.g. Dispute #88 raised with provider; user refunded via Fund Transfer" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} />
          <View style={styles.modalActions}>
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Mark Resolved" onPress={submit} loading={saving} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  runRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' },
  btn: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 12, alignSelf: 'flex-start' },
  btnText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 480, gap: 12 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 20, fontSize: 13.5 },
});
