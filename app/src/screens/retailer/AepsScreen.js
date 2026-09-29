import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Button, TextField, Select, Alert } from '../../components/UI';
import Receipt from '../../components/Receipt';
import { api } from '../../api/client';
import { colors, radius } from '../../theme';
import { ServiceHeader } from './serviceKit';

const TITLES = { aeps: 'AEPS — Aadhaar Enabled Payment System', 'aadhar-pay': 'Aadhar Pay', 'micro-atm': 'Micro ATM' };
const TXN = [{ label: 'Balance Enquiry', value: 'balance' }, { label: 'Cash Withdrawal', value: 'withdrawal' }, { label: 'Mini Statement', value: 'mini' }];
const BANKS = ['Airtel Payment Bank', 'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Bank of Baroda', 'Punjab National Bank', 'Axis Bank'].map((b) => ({ label: b, value: b }));

export default function AepsScreen({ kind = 'aeps', onBack, onDone }) {
  const [devices, setDevices] = useState([]);
  const [form, setForm] = useState({ txnType: 'balance', deviceType: '', mobile: '', aadhaar: '', bank: '', amount: '' });
  const [t1, setT1] = useState(true); const [t2, setT2] = useState(true);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(null); const [receipt, setReceipt] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => { api.aeps.devices().then((r) => setDevices((r.devices || []).map((d) => ({ label: d, value: d })))).catch(() => {}); }, []);

  const capture = async () => {
    setError(null);
    if (!/^\d{12}$/.test(form.aadhaar)) { setError('Enter a valid 12-digit Aadhaar number'); return; }
    if (!t1 || !t2) { setError('Please accept the terms & conditions'); return; }
    setLoading(true);
    const fn = kind === 'aadhar-pay' ? api.aeps.aadharPay : kind === 'micro-atm' ? api.aeps.microAtm : api.aeps.transact;
    try {
      const body = { txnType: form.txnType, deviceType: form.deviceType, mobile: form.mobile, aadhaar: form.aadhaar, bank: form.bank, bio: 'MOCK-PID-BLOCK' };
      if (form.txnType === 'withdrawal') body.amount = Number(form.amount);
      const r = await fn(body); setReceipt(r.receipt); onDone && onDone();
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const p = receipt?.provider || {};
  const rows = receipt ? [
    ['Type', receipt.title], ['Bank', receipt.operator], ['Aadhaar', receipt.target],
    ...(p.currentBalance !== undefined ? [['Balance', `₹${Number(p.currentBalance).toFixed(2)}`]] : []),
    ...(receipt.amount ? [['Withdrawn', `₹${Number(receipt.amount).toFixed(2)}`]] : []),
    ['RRN', p.rrn || receipt.reference], ['Ack No', p.ack || '—'], ['Status', 'Success'],
    ...(receipt.balance !== undefined ? [['Wallet Balance', `₹${Number(receipt.balance).toFixed(2)}`]] : []),
  ] : [];

  return (
    <View style={{ gap: 16 }}>
      <ServiceHeader title={TITLES[kind]} onBack={onBack} />
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <View style={styles.grid}>
          <Field label="Txn Type *"><Select value={form.txnType} options={TXN} onChange={(v) => set('txnType', v)} searchable={false} /></Field>
          <Field label="Device Type *"><Select value={form.deviceType} options={devices} onChange={(v) => set('deviceType', v)} placeholder="Select" /></Field>
          <Field label="Mobile Number *"><TextField value={form.mobile} onChangeText={(v) => set('mobile', v.replace(/\D/g, ''))} placeholder="Enter 10-digit mobile" keyboardType="numeric" maxLength={10} /></Field>
          <View style={styles.bio}>
            <Text style={styles.bioLabel}>Biometrics *</Text>
            <View style={styles.bioBox}><Text style={{ fontSize: 40 }}>🔒</Text><Text style={styles.bioHint}>Fingerprint</Text></View>
          </View>
          <Field label="Aadhaar Number *"><TextField value={form.aadhaar} onChangeText={(v) => set('aadhaar', v.replace(/\D/g, ''))} placeholder="Enter 12-digit Aadhaar" keyboardType="numeric" maxLength={12} /></Field>
          <Field label="Bank Name *"><Select value={form.bank} options={BANKS} onChange={(v) => set('bank', v)} placeholder="Select Bank" /></Field>
          {form.txnType === 'withdrawal' ? <Field label="Withdrawal Amount *"><TextField value={form.amount} onChangeText={(v) => set('amount', v.replace(/[^\d.]/g, ''))} placeholder="Enter amount" keyboardType="numeric" /></Field> : null}
        </View>
        <Pressableish checked={t1} onToggle={() => setT1((x) => !x)} text="I/Customer hereby accept & confirm the terms & conditions." />
        <Pressableish checked={t2} onToggle={() => setT2((x) => !x)} text="I/Retailer hereby accept & confirm the terms & conditions." />
        <Text style={styles.note}>Note: You are not allowed to do more than 5 transactions of each type for the same Aadhaar.</Text>
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}><Button title="Capture Fingerprint" onPress={capture} loading={loading} /></View>
      </Card>

      <Receipt visible={!!receipt} status={receipt && receipt.status === 'pending' ? 'Processing' : 'Success'} onClose={() => setReceipt(null)} title="Customer Copy" rows={rows} />
    </View>
  );
}

function Field({ label, children }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>; }
function Pressableish({ checked, onToggle, text }) {
  return (
    <View style={styles.tc} onStartShouldSetResponder={() => { onToggle(); return true; }}>
      <View style={[styles.box, checked && styles.boxOn]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
      <Text style={styles.tcText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 14 },
  field: { flexGrow: 1, flexBasis: '30%', minWidth: 200, gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569' },
  bio: { flexGrow: 1, flexBasis: '30%', minWidth: 200 },
  bioLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  bioBox: { height: 96, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  bioHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  tc: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  box: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary }, tick: { color: '#fff', fontSize: 12, fontWeight: '800' },
  tcText: { color: colors.text, fontSize: 13, flex: 1 },
  note: { color: colors.muted, fontSize: 12, marginTop: 8 },
});
