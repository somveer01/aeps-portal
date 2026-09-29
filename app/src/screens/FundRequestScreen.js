import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Modal, ActivityIndicator, ScrollView, Image } from 'react-native';
import { Card, Button, Alert, Select, DateField, StatusBadge } from '../components/UI';
import { api, assetUrl } from '../api/client';
import { pickImage } from '../api/imagePicker';
import { colors, radius } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const STATUS_OPTIONS = [{ label: 'All', value: '' }, { label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' }, { label: 'Rejected', value: 'rejected' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const statusTone = (s) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning');
function fmtDate(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}
const approverLabel = (r) => (r.approver_role === 'admin' || !r.approver_id ? 'Admin' : (r.approver_code || '—'));

/**
 * One screen, three modes (the user who created an account approves its fund requests):
 *  - admin:   every request; the admin acts on requests from users the admin created.
 *  - network: requests from users I created; approving moves money out of my wallet (PIN).
 *  - mine:    my own requests, and a form to raise a new one.
 */
export default function FundRequestScreen({ mode = 'admin', onDone }) {
  const isMine = mode === 'mine'; const isNetwork = mode === 'network';
  const listApi = isMine ? api.myFundRequests.list : isNetwork ? api.network.fundRequests.list : api.reports.fundRequests;

  const [view, setView] = useState('list');
  const [notice, setNotice] = useState(null);
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', status: '' });
  const [applied, setApplied] = useState({});
  const [act, setAct] = useState(null); const [actStatus, setActStatus] = useState('approved'); const [adminRemark, setAdminRemark] = useState(''); const [actPin, setActPin] = useState(''); const [acting, setActing] = useState(false); const [actError, setActError] = useState(null);
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await listApi({ ...applied, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
    /* eslint-disable-next-line */
  }, [page, applied]);

  useEffect(() => {
    load(1);
    if (isNetwork) {
      api.network.users.list({ pageSize: 100 }).then((r) => {
        setUsers(r.rows);
        const seen = new Map(); r.rows.forEach((u) => seen.set(u.user_type_id, u.user_type_name));
        setUserTypes([...seen].map(([id, name]) => ({ id, name })));
      }).catch(() => {});
    } else if (!isMine) {
      api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
      api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    }
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const userOptions = [{ label: 'All', value: '' }, ...users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }))];

  // The admin sees every request but approves only those whose approver is the admin.
  const canAct = (r) => r.status === 'pending' && (isNetwork || (!isMine && (r.approver_role === 'admin' || !r.approver_id)));
  const openAct = (row) => { setAct(row); setActStatus('approved'); setAdminRemark(''); setActPin(''); setActError(null); };
  const submitAct = async () => {
    if (isNetwork && actStatus === 'approved' && !actPin) { setActError('Enter your transaction PIN or login password.'); return; }
    setActing(true); setActError(null);
    try {
      if (isNetwork) await api.network.fundRequests.act(act.id, { status: actStatus, adminRemark, transactionPassword: actPin });
      else await api.reports.actFundRequest(act.id, { status: actStatus, adminRemark });
      setAct(null); await load(page);
      if (onDone) onDone();
    } catch (e) { setActError(e.message); } finally { setActing(false); }
  };

  if (view === 'form') {
    return <NewRequestForm onBack={() => setView('list')} onCreated={(row) => { setNotice(`Request ${row.request_id} sent for approval.`); setView('list'); load(1); }} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);
  const showUser = !isMine;

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>{total} Fund Requests</Text>
        {isMine ? <Button title="+ NEW REQUEST" onPress={() => { setNotice(null); setView('form'); }} /> : null}
      </View>
      {notice ? <Alert type="success">{notice}</Alert> : null}
      {isNetwork ? <Text style={styles.note}>Requests from users you created. Approving moves the amount from your wallet to theirs, so collect the payment first.</Text> : null}
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          {showUser ? <Fld label="User Type"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="All" /></Fld> : null}
          {showUser ? <Fld label="User Id"><Select value={ff.userId} options={userOptions} onChange={(v) => set('userId', v)} placeholder="All" /></Fld> : null}
          <Fld label="Fund Status"><Select value={ff.status} options={STATUS_OPTIONS} onChange={(v) => set('status', v)} searchable={false} /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: showUser ? 1760 : 1380, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text numberOfLines={1} style={[styles.cell, styles.cNo, styles.thText]}>#</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cBank, styles.thText]}>Bank Details</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cDate, styles.thText]}>Deposit Date</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cMode, styles.thText]}>Mode</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cAmt, styles.thText]}>Amount</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cUtr, styles.thText]}>UTR / Ref</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cReq, styles.thText]}>Request Id</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cRemark, styles.thText]}>Remark</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cRemark, styles.thText]}>Approver Remark</Text>
              {showUser ? <Text numberOfLines={1} style={[styles.cell, styles.cUser, styles.thText]}>User</Text> : null}
              {showUser ? <Text numberOfLines={1} style={[styles.cell, styles.cOutlet, styles.thText]}>Outlet</Text> : null}
              {!isNetwork ? <Text numberOfLines={1} style={[styles.cell, styles.cAppr, styles.thText]}>Approver</Text> : null}
              {showUser ? <Text numberOfLines={1} style={[styles.cell, styles.cAction, styles.thText]}>Action</Text> : null}
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>{isMine ? 'No requests yet. Tap + NEW REQUEST after you pay.' : 'No fund requests found.'}</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.cNo, styles.td]}>{from + i}</Text>
                    <View style={[styles.cell, styles.cBank]}><Text style={styles.td}>{r.bank_name || (r.approver_role === 'admin' ? '—' : `Paid to ${approverLabel(r)}`)}</Text><Text style={styles.sub}>{r.account_no || ''}</Text></View>
                    <Text style={[styles.cell, styles.cDate, styles.td]}>{fmtDate(r.deposit_date)}</Text>
                    <Text style={[styles.cell, styles.cMode, styles.td]}>{r.payment_mode || '—'}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.amount)}</Text>
                    <View style={[styles.cell, styles.cUtr]}><Text style={styles.td}>{r.receipt_no || '—'}</Text>{r.receipt_img ? <Text style={styles.sub}>Proof attached</Text> : null}</View>
                    <Text style={[styles.cell, styles.cReq, styles.td]}>{r.request_id}</Text>
                    <View style={[styles.cell, styles.cStatus]}><StatusBadge label={r.status} tone={statusTone(r.status)} /></View>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={2}>{r.remark || '—'}</Text>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={2}>{r.admin_remark || '—'}</Text>
                    {showUser ? <View style={[styles.cell, styles.cUser]}><Text style={styles.td}>{r.user_name}</Text><Text style={styles.sub}>{r.user_code} · {r.user_mobile}</Text></View> : null}
                    {showUser ? <Text style={[styles.cell, styles.cOutlet, styles.td]}>{r.outlet_name || '—'}</Text> : null}
                    {!isNetwork ? <View style={[styles.cell, styles.cAppr]}><Text style={styles.td}>{approverLabel(r)}</Text>{r.approver_role !== 'admin' && r.approver_name ? <Text style={styles.sub}>{r.approver_name}</Text> : null}</View> : null}
                    {showUser ? (
                      <View style={[styles.cell, styles.cAction]}>
                        {canAct(r) ? <Pressable onPress={() => openAct(r)} style={styles.actBtn}><Text style={styles.actBtnText}>Review</Text></Pressable>
                          : <Text style={styles.sub}>{r.status === 'pending' ? `With ${approverLabel(r)}` : '—'}</Text>}
                      </View>
                    ) : null}
                  </View>
                ))}
          </View>
        </ScrollView>
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>

      {/* Approve/Reject modal */}
      <Modal visible={!!act} transparent animationType="fade" onRequestClose={() => setAct(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Review Fund Request</Text>
            <Text style={styles.para}>{act?.user_name} ({act?.user_code}) · {money(act?.amount)} · {act?.payment_mode}{act?.receipt_no ? ` · UTR ${act.receipt_no}` : ''}</Text>
            {act?.receipt_img ? <Image source={{ uri: assetUrl(act.receipt_img) }} style={styles.proof} resizeMode="contain" /> : null}
            {actError ? <Alert type="error">{actError}</Alert> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setActStatus('approved')} style={[styles.typeBtn, actStatus === 'approved' && styles.typeOnGreen]}><Text style={actStatus === 'approved' ? styles.typeOnText : styles.typeText}>Approve</Text></Pressable>
              <Pressable onPress={() => setActStatus('rejected')} style={[styles.typeBtn, actStatus === 'rejected' && styles.typeOnRed]}><Text style={actStatus === 'rejected' ? styles.typeOnText : styles.typeText}>Reject</Text></Pressable>
            </View>
            <Text style={styles.label}>{isNetwork ? 'Remark' : 'Admin Remark'}</Text>
            <TextInput value={adminRemark} onChangeText={setAdminRemark} placeholder="Optional note" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} multiline />
            {isNetwork && actStatus === 'approved' ? (
              <TextInput value={actPin} onChangeText={setActPin} secureTextEntry placeholder="Transaction PIN / login password" placeholderTextColor={colors.muted} style={styles.input} />
            ) : null}
            {actStatus === 'approved' ? (
              <Text style={styles.sub}>{isNetwork ? `Approving moves ${money(act?.amount)} from your wallet to ${act?.user_code}.` : `Approving credits ${money(act?.amount)} to the user's wallet.`}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setAct(null)} style={{ flex: 1 }} />
              <Button title={actStatus === 'approved' ? 'Approve' : 'Reject'} onPress={submitAct} loading={acting} style={{ flex: 1, backgroundColor: actStatus === 'approved' ? colors.success : colors.danger }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// In-page form for "mine" mode (retailer / distributor / MD raising a request).
function NewRequestForm({ onBack, onCreated }) {
  const [meta, setMeta] = useState(null);
  const [f, setF] = useState({ companyBankId: '', paymentMode: 'UPI', amount: '', depositDate: '', utr: '', remark: '' });
  const [proof, setProof] = useState(null); const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { api.myFundRequests.meta().then(setMeta).catch((e) => setError(e.message)); }, []);
  const isAdmin = !!meta?.approver?.isAdmin;
  const bankOptions = (meta?.banks || []).map((b) => ({ label: `${b.bank_name} · ${b.account_no} · ${b.ifsc_code}`, value: b.id }));
  const modeOptions = (meta?.modes || ['UPI']).map((m) => ({ label: m, value: m }));
  const bank = (meta?.banks || []).find((b) => String(b.id) === String(f.companyBankId));

  const choosePhoto = async () => {
    setError(null);
    try { const picked = await pickImage(); if (!picked) return; setUploading(true); const { path } = await api.uploadImage(picked); setProof(path); }
    catch (e) { setError(e.message || 'Upload failed'); } finally { setUploading(false); }
  };

  const submit = async () => {
    setError(null);
    const amount = Number(f.amount);
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter the amount you paid.');
    if (isAdmin && !f.companyBankId) return setError('Choose the company bank you paid into.');
    if (!f.depositDate) return setError('Choose the date you paid.');
    if (f.paymentMode !== 'Cash' && f.utr.trim().length < 6) return setError('Enter the UTR / reference number from your payment.');
    setSaving(true);
    try {
      const r = await api.myFundRequests.create({ ...f, amount, utr: f.utr.trim(), proofImage: proof || '', companyBankId: f.companyBankId || null });
      onCreated(r.row);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>New Fund Request</Text>
        <Button title="ALL REQUESTS" onPress={onBack} />
      </View>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        {meta ? (
          <Text style={styles.note}>
            {isAdmin
              ? 'Pay into one of the company bank accounts below, then send this request. The admin checks the payment and adds the amount to your wallet.'
              : `Pay ${meta.approver.name} (${meta.approver.code}), who created your account, then send this request. They add the amount to your wallet from theirs.`}
          </Text>
        ) : <ActivityIndicator color={colors.primary} />}
        <View style={[styles.grid, { marginTop: 14 }]}>
          {isAdmin ? <Fld label="Company Bank *"><Select value={f.companyBankId} options={bankOptions} onChange={(v) => set('companyBankId', v)} placeholder={bankOptions.length ? 'Choose bank' : 'No company bank set up'} /></Fld> : null}
          <Fld label="Payment Mode *"><Select value={f.paymentMode} options={modeOptions} onChange={(v) => set('paymentMode', v)} searchable={false} /></Fld>
          <Fld label="Amount (₹) *"><TextInput value={f.amount} onChangeText={(v) => set('amount', v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.muted} style={styles.input} /></Fld>
          <Fld label="Payment Date *"><DateField value={f.depositDate} onChange={(v) => set('depositDate', v)} /></Fld>
          <Fld label={f.paymentMode === 'Cash' ? 'Receipt / Reference No.' : 'UTR / Reference No. *'}><TextInput value={f.utr} onChangeText={(v) => set('utr', v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="From your bank / UPI app" placeholderTextColor={colors.muted} autoCapitalize="characters" maxLength={30} style={styles.input} /></Fld>
          <Fld label="Remark"><TextInput value={f.remark} onChangeText={(v) => set('remark', v)} placeholder="Optional note" placeholderTextColor={colors.muted} style={styles.input} /></Fld>
        </View>
        {bank ? <Text style={styles.sub}>Account holder: {bank.account_holder || '—'} · A/c {bank.account_no} · IFSC {bank.ifsc_code}</Text> : null}
        <View style={styles.proofRow}>
          {proof ? <Image source={{ uri: assetUrl(proof) }} style={styles.proofThumb} resizeMode="cover" /> : null}
          <Button title={proof ? 'Change payment proof' : 'Upload payment proof'} variant="ghost" onPress={choosePhoto} loading={uploading} />
          {proof ? <Pressable onPress={() => setProof(null)}><Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text></Pressable> : null}
        </View>
        <View style={styles.formActions}>
          <Button title="Cancel" variant="ghost" onPress={onBack} style={{ minWidth: 120 }} />
          <Button title="Send Request" onPress={submit} loading={saving} style={{ minWidth: 160 }} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  cNo: { width: 40 }, cBank: { width: 150 }, cDate: { width: 110 }, cMode: { width: 80 }, cAmt: { width: 90 }, cUtr: { width: 150 }, cReq: { width: 150 }, cStatus: { width: 115 }, cRemark: { width: 150 }, cUser: { width: 160 }, cOutlet: { width: 130 }, cAppr: { width: 140 }, cAction: { width: 110 },
  actBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'flex-start' },
  actBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 440, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 21 },
  proof: { width: '100%', height: 180, borderRadius: radius.sm, backgroundColor: '#f1f5f9' },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' },
  proofThumb: { width: 64, height: 64, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  formActions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' },
  typeBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  typeOnGreen: { backgroundColor: colors.success, borderColor: colors.success },
  typeOnRed: { backgroundColor: colors.danger, borderColor: colors.danger },
  typeText: { color: colors.text, fontWeight: '600' },
  typeOnText: { color: '#fff', fontWeight: '700' },
});
