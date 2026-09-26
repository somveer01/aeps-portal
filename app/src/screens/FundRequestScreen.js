import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Button, Alert, Select, DateField, StatusBadge } from '../components/UI';
import { api } from '../api/client';
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

export default function FundRequestScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [userTypes, setUserTypes] = useState([]); const [users, setUsers] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', userTypeId: '', userId: '', status: '' });
  const [applied, setApplied] = useState({});
  const [act, setAct] = useState(null); const [actStatus, setActStatus] = useState('approved'); const [adminRemark, setAdminRemark] = useState(''); const [acting, setActing] = useState(false); const [actError, setActError] = useState(null);
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.reports.fundRequests({ ...applied, page: p, pageSize: PAGE_SIZE }); setRows(res.rows); setTotal(res.total); setPage(res.page); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied]);

  useEffect(() => {
    load(1);
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.managedUsers.list({ pageSize: 100 }).then((r) => setUsers(r.rows)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const utOptions = [{ label: 'All', value: '' }, ...userTypes.map((u) => ({ label: u.name, value: u.id }))];
  const userOptions = [{ label: 'All', value: '' }, ...users.map((u) => ({ label: `${u.user_code} · ${u.name}`, value: u.id }))];

  const openAct = (row) => { setAct(row); setActStatus('approved'); setAdminRemark(''); setActError(null); };
  const submitAct = async () => {
    setActing(true); setActError(null);
    try { await api.reports.actFundRequest(act.id, { status: actStatus, adminRemark }); setAct(null); await load(page); }
    catch (e) { setActError(e.message); } finally { setActing(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.heading}>{total} Fund Requests</Text>
      <Card>
        <View style={styles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="User Type"><Select value={ff.userTypeId} options={utOptions} onChange={(v) => set('userTypeId', v)} placeholder="All" /></Fld>
          <Fld label="User Id"><Select value={ff.userId} options={userOptions} onChange={(v) => set('userId', v)} placeholder="All" /></Fld>
          <Fld label="Fund Status"><Select value={ff.status} options={STATUS_OPTIONS} onChange={(v) => set('status', v)} searchable={false} /></Fld>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 1500, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text numberOfLines={1} style={[styles.cell, styles.cNo, styles.thText]}>#</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cBank, styles.thText]}>Bank Details</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cDate, styles.thText]}>Deposit Date</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cMode, styles.thText]}>Mode</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cAmt, styles.thText]}>Amount</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cReq, styles.thText]}>Request Id</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cRemark, styles.thText]}>Remark</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cRemark, styles.thText]}>Admin Remark</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cUser, styles.thText]}>User</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cOutlet, styles.thText]}>Outlet</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cAction, styles.thText]}>Action</Text>
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No fund requests found.</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.cNo, styles.td]}>{from + i}</Text>
                    <View style={[styles.cell, styles.cBank]}><Text style={styles.td}>{r.bank_name || '—'}</Text><Text style={styles.sub}>{r.account_no || ''}</Text></View>
                    <Text style={[styles.cell, styles.cDate, styles.td]}>{fmtDate(r.deposit_date)}</Text>
                    <Text style={[styles.cell, styles.cMode, styles.td]}>{r.payment_mode || '—'}</Text>
                    <Text style={[styles.cell, styles.cAmt, styles.td]}>{money(r.amount)}</Text>
                    <Text style={[styles.cell, styles.cReq, styles.td]}>{r.request_id}</Text>
                    <View style={[styles.cell, styles.cStatus]}><StatusBadge label={r.status} tone={statusTone(r.status)} /></View>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={2}>{r.remark || '—'}</Text>
                    <Text style={[styles.cell, styles.cRemark, styles.td]} numberOfLines={2}>{r.admin_remark || '—'}</Text>
                    <View style={[styles.cell, styles.cUser]}><Text style={styles.td}>{r.user_name}</Text><Text style={styles.sub}>{r.user_code} · {r.user_mobile}</Text></View>
                    <Text style={[styles.cell, styles.cOutlet, styles.td]}>{r.outlet_name || '—'}</Text>
                    <View style={[styles.cell, styles.cAction]}>
                      {r.status === 'pending'
                        ? <Pressable onPress={() => openAct(r)} style={styles.actBtn}><Text style={styles.actBtnText}>Review</Text></Pressable>
                        : <Text style={styles.sub}>—</Text>}
                    </View>
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
            <Text style={styles.para}>{act?.user_name} ({act?.user_code}) · {money(act?.amount)} · {act?.request_id}</Text>
            {actError ? <Alert type="error">{actError}</Alert> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setActStatus('approved')} style={[styles.typeBtn, actStatus === 'approved' && styles.typeOnGreen]}><Text style={actStatus === 'approved' ? styles.typeOnText : styles.typeText}>Approve</Text></Pressable>
              <Pressable onPress={() => setActStatus('rejected')} style={[styles.typeBtn, actStatus === 'rejected' && styles.typeOnRed]}><Text style={actStatus === 'rejected' ? styles.typeOnText : styles.typeText}>Reject</Text></Pressable>
            </View>
            <Text style={styles.label}>Admin Remark</Text>
            <TextInput value={adminRemark} onChangeText={setAdminRemark} placeholder="Optional note" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} multiline />
            {actStatus === 'approved' ? <Text style={styles.sub}>Approving credits {money(act?.amount)} to the user's wallet.</Text> : null}
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

const styles = StyleSheet.create({
  ...reportStyles,
  cNo: { width: 40 }, cBank: { width: 140 }, cDate: { width: 110 }, cMode: { width: 80 }, cAmt: { width: 90 }, cReq: { width: 130 }, cStatus: { width: 115 }, cRemark: { width: 150 }, cUser: { width: 160 }, cOutlet: { width: 130 }, cAction: { width: 90 },
  actBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'flex-start' },
  actBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
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
});
