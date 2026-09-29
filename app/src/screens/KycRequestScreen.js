import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, ScrollView, Pressable, Image, Modal } from 'react-native';
import { Card, Button, Alert, Select, StatusBadge } from '../components/UI';
import { api, assetUrl } from '../api/client';
import { colors, radius } from '../theme';
import { Pager, reportStyles } from './AccountHistoryScreen';
import { KYC_DOCS } from './retailer/KycScreen';

const PAGE_SIZE = 10;
const STATUS_OPTIONS = [{ label: 'Pending review', value: 'pending' }, { label: 'Approved', value: 'approved' }, { label: 'Rejected', value: 'rejected' }, { label: 'All', value: '' }];
const tone = (s) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning');
const dt = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const COLS = [40, 190, 120, 110, 120, 110, 150, 115, 150, 100];

// Admin: KYC submissions waiting for review; opens a submission in-page to approve or reject.
export default function KycRequestScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending'); const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError(null);
    try { const r = await api.kyc.requests({ status, q, page: p, pageSize: PAGE_SIZE }); setRows(r.rows); setTotal(r.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [status, q]);
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [load]);

  if (open) {
    return <Review sub={open} onBack={() => setOpen(null)}
      onDone={(row) => { setNotice(`${row.user_code}: KYC ${row.status}.`); setOpen(null); load(page); }} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);
  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} KYC {status === 'pending' ? 'requests waiting' : 'submissions'}</Text>
      {notice ? <Alert type="success">{notice}</Alert> : null}
      <Card>
        <View style={styles.filters}>
          <View style={{ minWidth: 200 }}><Select label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} searchable={false} /></View>
          <View style={{ flexGrow: 1, minWidth: 220, gap: 6 }}>
            <Text style={styles.label}>Search</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Name, user ID, mobile or PAN" placeholderTextColor={colors.muted} style={styles.input} />
          </View>
        </View>
      </Card>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: COLS.reduce((a, b) => a + b, 0), flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              {['#', 'User', 'Type', 'Mobile', 'PAN', 'Aadhaar', 'Submitted', 'Status', 'Reviewed', 'Action'].map((h, i) => (
                <Text key={h} numberOfLines={1} style={[styles.cell, styles.thText, { width: COLS[i] }]}>{h}</Text>
              ))}
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>{status === 'pending' ? 'No KYC waiting for review.' : 'No submissions found.'}</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.td, { width: COLS[0] }]}>{from + i}</Text>
                    <View style={[styles.cell, { width: COLS[1] }]}><Text style={styles.td} numberOfLines={1}>{r.user_name}</Text><Text style={styles.sub}>{r.user_code}{r.outlet_name ? ` · ${r.outlet_name}` : ''}</Text></View>
                    <Text style={[styles.cell, styles.td, { width: COLS[2] }]}>{r.user_type_name}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[3] }]}>{r.user_mobile}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[4] }]}>{r.pan_number}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[5] }]}>XXXX {r.aadhaar_last4}</Text>
                    <Text style={[styles.cell, styles.td, { width: COLS[6] }]}>{dt(r.created_at)}</Text>
                    <View style={[styles.cell, { width: COLS[7] }]}><StatusBadge label={r.status} tone={tone(r.status)} /></View>
                    <View style={[styles.cell, { width: COLS[8] }]}><Text style={styles.td}>{r.reviewed_at ? dt(r.reviewed_at) : '—'}</Text>{r.reviewed_by_code ? <Text style={styles.sub}>by {r.reviewed_by_code}</Text> : null}</View>
                    <View style={[styles.cell, { width: COLS[9] }]}>
                      <Pressable onPress={() => setOpen(r)} style={[styles.actBtn, r.status !== 'pending' && styles.actBtnGhost]}>
                        <Text style={[styles.actBtnText, r.status !== 'pending' && { color: colors.primary }]}>{r.status === 'pending' ? 'Review' : 'View'}</Text>
                      </Pressable>
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

function Review({ sub, onBack, onDone }) {
  const [remark, setRemark] = useState(''); const [saving, setSaving] = useState(null); const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(null);
  const pending = sub.status === 'pending';

  const act = async (status) => {
    setError(null);
    if (status === 'rejected' && remark.trim().length < 3) { setError('Write the reason for rejecting, so the user knows what to fix.'); return; }
    setSaving(status);
    try { const r = await api.kyc.review(sub.id, { status, remark: remark.trim() }); onDone(r.row); }
    catch (e) { setError(e.message); } finally { setSaving(null); }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>KYC — {sub.user_name} ({sub.user_code})</Text>
        <Button title="ALL KYC REQUESTS" onPress={onBack} />
      </View>
      <Card>
        <View style={styles.sumHead}>
          <Text style={styles.cardTitle}>{sub.user_type_name} · {sub.user_mobile} · submitted {dt(sub.created_at)}</Text>
          <StatusBadge label={sub.status} tone={tone(sub.status)} />
        </View>
        <View style={styles.kv}>
          {[['Aadhaar', `XXXX XXXX ${sub.aadhaar_last4}`], ['PAN', sub.pan_number], ['Bank', sub.bank_name], ['Account holder', sub.account_holder],
            ['Account no.', sub.account_no], ['IFSC', sub.ifsc_code], ['Shop', sub.outlet_name || '—']].map(([k, v]) => (
            <View key={k} style={styles.kvRow}><Text style={styles.kvKey}>{k}</Text><Text style={styles.kvVal}>{v}</Text></View>
          ))}
          {sub.review_remark ? <View style={styles.kvRow}><Text style={styles.kvKey}>Review note</Text><Text style={styles.kvVal}>{sub.review_remark}</Text></View> : null}
        </View>
        <Text style={styles.hint}>Check that the Aadhaar last 4 digits, PAN, name and photo match across the documents. Tap a photo to enlarge.</Text>
        <View style={styles.docs}>
          {KYC_DOCS.map((d) => (
            <Pressable key={d.key} style={styles.docBox} onPress={() => sub.files[d.field] && setZoom({ url: assetUrl(sub.files[d.field]), label: d.label })}>
              {sub.files[d.field]
                ? <Image source={{ uri: assetUrl(sub.files[d.field]) }} style={styles.docImg} resizeMode="cover" />
                : <View style={[styles.docImg, styles.docEmpty]}><Text style={{ color: colors.muted, fontSize: 12 }}>Not provided</Text></View>}
              <Text style={styles.docLabel} numberOfLines={2}>{d.label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {pending ? (
        <Card>
          {error ? <Alert type="error">{error}</Alert> : null}
          <Text style={styles.label}>Reason (needed to reject; shown to the user)</Text>
          <TextInput value={remark} onChangeText={setRemark} multiline placeholder="e.g. PAN photo is blurred, upload a clearer one" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 80, textAlignVertical: 'top', marginTop: 6 }]} />
          <View style={styles.actions}>
            <Button title="Reject" onPress={() => act('rejected')} loading={saving === 'rejected'} disabled={!!saving} style={{ minWidth: 140, backgroundColor: colors.danger }} />
            <Button title="Approve KYC" onPress={() => act('approved')} loading={saving === 'approved'} disabled={!!saving} style={{ minWidth: 160, backgroundColor: colors.success }} />
          </View>
          <Text style={styles.hint}>Approving marks the user's KYC verified and unlocks their services.</Text>
        </Card>
      ) : null}

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={styles.zoomBackdrop} onPress={() => setZoom(null)}>
          {zoom ? <Image source={{ uri: zoom.url }} style={styles.zoomImg} resizeMode="contain" /> : null}
          <Text style={styles.zoomLabel}>{zoom ? zoom.label : ''} · tap to close</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' },
  actBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'flex-start' },
  actBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  actBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  sumHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  kv: { marginTop: 12, gap: 6 },
  kvRow: { flexDirection: 'row', gap: 10 },
  kvKey: { width: 130, color: colors.muted, fontSize: 13 },
  kvVal: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12.5, marginTop: 12 },
  docs: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  docBox: { width: 200, gap: 6 },
  docImg: { width: 200, height: 140, borderRadius: radius.sm, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border },
  docEmpty: { alignItems: 'center', justifyContent: 'center' },
  docLabel: { fontSize: 12.5, color: colors.text, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.85)', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
  zoomImg: { width: '100%', height: '80%' },
  zoomLabel: { color: '#fff', fontWeight: '600' },
});
