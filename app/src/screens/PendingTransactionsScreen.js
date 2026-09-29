import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, ScrollView, Pressable, Modal } from 'react-native';
import { Card, Button, Alert } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';
import { Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const COLS = [40, 170, 130, 130, 100, 170, 110, 120, 230];
function age(sec) {
  const s = Number(sec || 0);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} hr`;
  return `${Math.floor(s / 86400)} day${s >= 172800 ? 's' : ''}`;
}
const STUCK_SEC = 24 * 3600;

// Admin: transactions the provider has not confirmed yet. The status-check job settles
// most of them; anything older than a day needs a ticket with the provider.
export default function PendingTransactionsScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null); const [settle, setSettle] = useState(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError(null);
    try { const r = await api.pending.list({ q, page: p, pageSize: PAGE_SIZE }); setRows(r.rows); setTotal(r.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [load]);

  const checkAll = async () => {
    setBusy('all'); setError(null); setNotice(null);
    try { const r = await api.pending.checkAll(); setNotice(`Checked ${r.checked} with the provider; ${r.settled} settled.`); await load(1); }
    catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const checkOne = async (r) => {
    setBusy(r.id); setError(null); setNotice(null);
    try {
      const res = await api.pending.checkOne(r.id);
      setNotice(res.status === 'pending' ? `${r.client_ref}: provider still says pending.` : `${r.client_ref}: settled as ${res.status}.`);
      await load(page);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>{total} pending transaction{total === 1 ? '' : 's'}</Text>
        <Button title="Check all with provider" onPress={checkAll} loading={busy === 'all'} disabled={!!busy} />
      </View>
      <Text style={styles.note}>The money for these is on hold (debited, not yet paid out or refunded). The provider's callback or the automatic status check settles them; success pays commission, failure refunds the user. Settle by hand only after the provider confirms, for example on a support ticket.</Text>
      {notice ? <Alert type="success">{notice}</Alert> : null}
      {error ? <Alert type="error">{error}</Alert> : null}
      <Card>
        <View style={{ gap: 6, marginBottom: 12 }}>
          <Text style={styles.label}>Search</Text>
          <TextInput value={q} onChangeText={setQ} placeholder="User ID, name, our ref or provider ref" placeholderTextColor={colors.muted} style={styles.input} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: COLS.reduce((a, b) => a + b, 0), flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              {['#', 'User', 'Service', 'Target', 'Amount', 'Our ref / provider ref', 'Waiting', 'Checks', 'Action'].map((h, i) => (
                <Text key={h} numberOfLines={1} style={[styles.cell, styles.thText, { width: COLS[i] }]}>{h}</Text>
              ))}
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>Nothing pending. Every transaction has a final status.</Text></View>
                : rows.map((r, i) => {
                  const stuck = Number(r.age_seconds) >= STUCK_SEC;
                  return (
                    <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null, stuck && styles.stuck]}>
                      <Text style={[styles.cell, styles.td, { width: COLS[0] }]}>{from + i}</Text>
                      <View style={[styles.cell, { width: COLS[1] }]}><Text style={styles.td} numberOfLines={1}>{r.user_name}</Text><Text style={styles.sub}>{r.user_code}</Text></View>
                      <View style={[styles.cell, { width: COLS[2] }]}><Text style={styles.td}>{r.service}</Text>{r.operator ? <Text style={styles.sub} numberOfLines={1}>{r.operator}</Text> : null}</View>
                      <Text style={[styles.cell, styles.td, { width: COLS[3] }]} numberOfLines={1}>{r.target || '—'}</Text>
                      <View style={[styles.cell, { width: COLS[4] }]}><Text style={styles.td}>{money(r.amount)}</Text>{Number(r.debit_amount) !== Number(r.amount) ? <Text style={styles.sub}>held {money(r.debit_amount)}</Text> : null}</View>
                      <View style={[styles.cell, { width: COLS[5] }]}><Text style={styles.td} numberOfLines={1}>{r.client_ref}</Text><Text style={styles.sub} numberOfLines={1}>{r.reference_id || '—'}</Text></View>
                      <View style={[styles.cell, { width: COLS[6] }]}><Text style={[styles.td, stuck && { color: colors.danger, fontWeight: '700' }]}>{age(r.age_seconds)}</Text>{stuck ? <Text style={[styles.sub, { color: colors.danger }]}>Raise with provider</Text> : null}</View>
                      <Text style={[styles.cell, styles.td, { width: COLS[7] }]}>{r.check_count}</Text>
                      <View style={[styles.cell, styles.actions, { width: COLS[8] }]}>
                        <Pressable onPress={() => checkOne(r)} disabled={!!busy} style={styles.btn}><Text style={styles.btnText}>{busy === r.id ? '…' : 'Check now'}</Text></Pressable>
                        <Pressable onPress={() => setSettle({ row: r, status: 'success' })} disabled={!!busy} style={[styles.btn, styles.btnOk]}><Text style={[styles.btnText, { color: '#fff' }]}>Success</Text></Pressable>
                        <Pressable onPress={() => setSettle({ row: r, status: 'failed' })} disabled={!!busy} style={[styles.btn, styles.btnBad]}><Text style={[styles.btnText, { color: '#fff' }]}>Failed</Text></Pressable>
                      </View>
                    </View>
                  );
                })}
          </View>
        </ScrollView>
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
      <SettleModal settle={settle} onClose={() => setSettle(null)} onDone={(msg) => { setSettle(null); setNotice(msg); load(page); }} />
    </View>
  );
}

function SettleModal({ settle, onClose, onDone }) {
  const [note, setNote] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState(null);
  useEffect(() => { setNote(''); setError(null); }, [settle]);
  if (!settle) return null;
  const { row, status } = settle;
  const ok = status === 'success';
  const submit = async () => {
    setError(null);
    if (note.trim().length < 3) { setError('Write what the provider confirmed (ticket or reference).'); return; }
    setSaving(true);
    try { await api.pending.settle(row.id, { status, note: note.trim() }); onDone(`${row.client_ref} marked ${status}.`); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Mark {row.client_ref} as {ok ? 'successful' : 'failed'}?</Text>
          <Text style={styles.para}>{row.user_name} ({row.user_code}) · {row.service} · {money(row.amount)}</Text>
          <Text style={styles.para}>{ok ? 'The user keeps the debit and receives their commission; uplines get their chain share.' : `The user is refunded ${money(row.debit_amount)}.`} This cannot be undone.</Text>
          {error ? <Alert type="error">{error}</Alert> : null}
          <TextInput value={note} onChangeText={setNote} multiline placeholder="e.g. Provider ticket #1234 confirmed failure" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} />
          <View style={styles.modalActions}>
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button title={ok ? 'Mark Success' : 'Mark Failed & Refund'} onPress={submit} loading={saving} style={{ flex: 1, backgroundColor: ok ? colors.success : colors.danger }} />
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
  stuck: { backgroundColor: colors.dangerBg },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  btn: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 9 },
  btnOk: { backgroundColor: colors.success, borderColor: colors.success },
  btnBad: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 460, gap: 12 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 20, fontSize: 13.5 },
});
