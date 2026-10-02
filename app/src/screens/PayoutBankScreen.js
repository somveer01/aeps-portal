import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Modal, ActivityIndicator, ScrollView, Image } from 'react-native';
import { Card, Button, Alert, Select, DateField, StatusBadge } from '../components/UI';
import { api, assetUrl } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { pickImage } from '../api/imagePicker';
import { colors, radius } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';

const PAGE_SIZE = 10;
const STATUS_OPTIONS = [{ label: 'All', value: '' }, { label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' }, { label: 'Rejected', value: 'rejected' }];
const statusTone = (s) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning');
function fmtDate(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}

export default function PayoutBankScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', status: '' });
  const [applied, setApplied] = useState({});
  // add/edit form
  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [f, setF] = useState({ userId: '', bankName: '', accountNo: '', ifscCode: '', acHolder: '', passbook: null });
  const [imgBusy, setImgBusy] = useState(false); const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  // review + view-image
  const [act, setAct] = useState(null); const [actStatus, setActStatus] = useState('approved'); const [remark, setRemark] = useState(''); const [acting, setActing] = useState(false); const [actError, setActError] = useState(null);
  const [viewImg, setViewImg] = useState(null);
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));
  const setForm = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.payoutBanks.list({ ...applied, ...grid.params, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => {
    load(1);
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const userFilterOptions = [{ label: 'All', value: '' }, ...users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }))];
  const userOptions = users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }));

  const openAdd = () => { setEditing(null); setF({ userId: users[0]?.id ?? '', bankName: '', accountNo: '', ifscCode: '', acHolder: '', passbook: null }); setFormError(null); setView('form'); };
  const openEdit = (r) => { setEditing(r); setF({ userId: r.user_id, bankName: r.bank_name, accountNo: r.account_no, ifscCode: r.ifsc_code, acHolder: r.ac_holder, passbook: r.passbook || null }); setFormError(null); setView('form'); };

  const choosePassbook = async () => {
    setFormError(null);
    try { const picked = await pickImage(); if (!picked) return; setImgBusy(true); const { path } = await api.uploadImage(picked); setForm('passbook', path); }
    catch (e) { setFormError(e.message || 'Upload failed'); } finally { setImgBusy(false); }
  };
  const save = async () => {
    if (!f.userId) { setFormError('Please select a user.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = { userId: f.userId, bankName: f.bankName.trim(), accountNo: f.accountNo.trim(), ifscCode: f.ifscCode.trim().toUpperCase(), acHolder: f.acHolder.trim(), passbook: f.passbook || '' };
      if (editing) await api.payoutBanks.update(editing.id, body); else await api.payoutBanks.create(body);
      setView('list'); await load(editing ? page : 1);
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };

  const openAct = (row) => { setAct(row); setActStatus('approved'); setRemark(''); setActError(null); };
  const submitAct = async () => {
    setActing(true); setActError(null);
    try { await api.payoutBanks.act(act.id, { status: actStatus, remark }); setAct(null); await load(page); }
    catch (e) { setActError(e.message); } finally { setActing(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  // ── FORM VIEW ──
  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.formHeaderBar}>
          <Text style={styles.formHeading}>{editing ? 'Edit Payout Bank' : 'Add Payout Bank'}</Text>
          <Button title="ALL PAYOUT BANKS" onPress={() => setView('list')} style={{ paddingHorizontal: 18 }} />
        </View>
        <Card>
          {formError ? <Alert type="error">{formError}</Alert> : null}
          <View style={styles.fgrid}>
            <View style={styles.ffield}><Select label="User *" value={f.userId} options={userOptions} onChange={(v) => setForm('userId', v)} placeholder="-- Select User --" /></View>
            <View style={styles.ffield}><Text style={styles.label}>Bank Name *</Text><TextInput value={f.bankName} onChangeText={(v) => setForm('bankName', v)} placeholder="e.g. HDFC Bank" placeholderTextColor={colors.muted} style={styles.input} /></View>
            <View style={styles.ffield}><Text style={styles.label}>Account No *</Text><TextInput value={f.accountNo} onChangeText={(v) => setForm('accountNo', v)} keyboardType="numeric" placeholder="Account number" placeholderTextColor={colors.muted} style={styles.input} /></View>
            <View style={styles.ffield}><Text style={styles.label}>IFSC Code *</Text><TextInput value={f.ifscCode} onChangeText={(v) => setForm('ifscCode', v)} autoCapitalize="characters" placeholder="e.g. HDFC0001234" placeholderTextColor={colors.muted} style={styles.input} /></View>
            <View style={styles.ffield}><Text style={styles.label}>AC Holder *</Text><TextInput value={f.acHolder} onChangeText={(v) => setForm('acHolder', v)} placeholder="Account holder name" placeholderTextColor={colors.muted} style={styles.input} /></View>
            <View style={styles.ffieldFull}>
              <Text style={styles.label}>Passbook / Cheque Image</Text>
              <View style={styles.imgRow}>
                {f.passbook ? <Image source={{ uri: assetUrl(f.passbook) }} style={styles.passPreview} resizeMode="cover" />
                  : <View style={[styles.passPreview, styles.imgEmpty]}><Text style={{ color: '#94a3b8' }}>No image</Text></View>}
                <View style={{ gap: 6 }}>
                  <Button title={f.passbook ? 'Change image' : 'Upload passbook'} variant="ghost" onPress={choosePassbook} loading={imgBusy} style={{ minWidth: 150 }} />
                  {f.passbook ? <Pressable onPress={() => setForm('passbook', null)}><Text style={{ color: colors.danger, fontWeight: '600', fontSize: 12 }}>Remove</Text></Pressable> : null}
                </View>
              </View>
            </View>
          </View>
          <View style={styles.formActions}>
            <Button title="Cancel" variant="ghost" onPress={() => setView('list')} style={{ minWidth: 120 }} />
            <Button title={editing ? 'Save' : 'Create'} onPress={save} loading={saving} style={{ minWidth: 150 }} />
          </View>
        </Card>
      </View>
    );
  }

  // ── LIST VIEW ──
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.topBar}>
        <Text style={styles.heading}>{total} Payout Banks</Text>
        <Button title="+ ADD PAYOUT BANK" onPress={openAdd} style={{ paddingHorizontal: 20 }} />
      </View>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="User Type"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="All" /></Fld>
          <Fld label="User Id"><Select value={ff.userId} options={userFilterOptions} onChange={(v) => set('userId', v)} placeholder="All" /></Fld>
          <Fld label="Account Status"><Select value={ff.status} options={STATUS_OPTIONS} onChange={(v) => set('status', v)} searchable={false} /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading}
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'bank_name', title: 'Bank Name', width: 150 },
            { key: 'account_no', title: 'Account No', width: 170 },
            { key: 'ifsc_code', title: 'IFSC', width: 125 },
            { key: 'ac_holder', title: 'AC Holder', width: 150 },
            { key: 'passbook', title: 'Passbook', width: 100, sortable: false, filterable: false, render: (r) => (r.passbook ? <Pressable onPress={() => setViewImg(assetUrl(r.passbook))}><Image source={{ uri: assetUrl(r.passbook) }} style={styles.thumb} resizeMode="cover" /></Pressable> : <Text style={styles.td}>NA</Text>) },
            { key: 'status', title: 'Status', width: 115, render: (r) => <StatusBadge label={r.status} tone={statusTone(r.status)} /> },
            { key: 'user', title: 'User Id', width: 180, render: (r) => <View><Text style={styles.td}>{r.user_code}</Text><Text style={styles.sub}>{r.user_name}</Text></View> },
            { key: 'remark', title: 'Remark', flex: 1, minWidth: 220, render: (r) => <Text style={styles.td} numberOfLines={2}>{r.remark || '—'}</Text> },
            { key: 'created_at', title: 'Date', width: 130, render: (r) => <Text style={styles.td}>{fmtDate(r.created_at)}</Text> },
            { key: 'action', title: 'Action', width: 130, sortable: false, filterable: false, render: (r) => (<View style={styles.actions}>{r.status === 'pending' ? <Pressable onPress={() => openAct(r)} style={styles.actBtn}><Text style={styles.actBtnText}>Review</Text></Pressable> : null}<Pressable onPress={() => openEdit(r)} hitSlop={6} style={styles.iconBtn}><Text style={{ color: colors.primary, fontSize: 14 }}>✎</Text></Pressable></View>) },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>

      {/* Review modal */}
      <Modal visible={!!act} transparent animationType="fade" onRequestClose={() => setAct(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Review Payout Bank</Text>
            <Text style={styles.para}>{act?.bank_name} · {act?.account_no} · {act?.user_code}</Text>
            {actError ? <Alert type="error">{actError}</Alert> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setActStatus('approved')} style={[styles.typeBtn, actStatus === 'approved' && styles.typeOnGreen]}><Text style={actStatus === 'approved' ? styles.typeOnText : styles.typeText}>Approve</Text></Pressable>
              <Pressable onPress={() => setActStatus('rejected')} style={[styles.typeBtn, actStatus === 'rejected' && styles.typeOnRed]}><Text style={actStatus === 'rejected' ? styles.typeOnText : styles.typeText}>Reject</Text></Pressable>
            </View>
            <Text style={styles.label}>Remark</Text>
            <TextInput value={remark} onChangeText={setRemark} placeholder="Optional note" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline />
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setAct(null)} style={{ flex: 1 }} />
              <Button title={actStatus === 'approved' ? 'Approve' : 'Reject'} onPress={submitAct} loading={acting} style={{ flex: 1, backgroundColor: actStatus === 'approved' ? colors.success : colors.danger }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Passbook full-image viewer */}
      <Modal visible={!!viewImg} transparent animationType="fade" onRequestClose={() => setViewImg(null)}>
        <Pressable style={styles.imgBackdrop} onPress={() => setViewImg(null)}>
          {viewImg ? <Image source={{ uri: viewImg }} style={styles.fullImg} resizeMode="contain" /> : null}
          <Text style={styles.imgClose}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  ...reportStyles,
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  formHeaderBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  formHeading: { fontSize: 20, fontWeight: '700', color: colors.text },
  formActions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 12, marginTop: 18 },
  fgrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14 },
  ffield: { flexGrow: 1, flexBasis: '30%', minWidth: 220, gap: 6 },
  ffieldFull: { width: '100%', gap: 6 },
  imgRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  passPreview: { width: 160, height: 96, borderRadius: radius.sm, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border },
  imgEmpty: { alignItems: 'center', justifyContent: 'center' },
  cNo: { width: 40 }, cName: { width: 130 }, cAcc: { width: 140 }, cIfsc: { width: 120 }, cPass: { width: 110 }, cStatus: { width: 115 }, cUser: { width: 130 }, cRemark: { width: 130 }, cDate: { width: 110 }, cAction: { width: 130 },
  thumb: { width: 50, height: 34, borderRadius: 4, backgroundColor: '#f1f5f9' },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  actBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12 },
  actBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  iconBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 440, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 21 },
  typeBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  typeOnGreen: { backgroundColor: colors.success, borderColor: colors.success },
  typeOnRed: { backgroundColor: colors.danger, borderColor: colors.danger },
  typeText: { color: colors.text, fontWeight: '600' },
  typeOnText: { color: '#fff', fontWeight: '700' },
  imgBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.85)', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14 },
  fullImg: { width: '90%', height: '80%' },
  imgClose: { color: '#fff', fontSize: 13 },
});
