import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

const TXN_OPTIONS = [{ label: 'Credit (add to user)', value: 'credit' }, { label: 'Debit (deduct from user)', value: 'debit' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;

export default function FundTransferScreen() {
  const [code, setCode] = useState('');
  const [receiver, setReceiver] = useState(null);
  const [looking, setLooking] = useState(false);
  const [amount, setAmount] = useState(''); const [remark, setRemark] = useState(''); const [txnType, setTxnType] = useState('credit'); const [txnPw, setTxnPw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null); const [info, setInfo] = useState(null);
  const [adminBalance, setAdminBalance] = useState(null);

  const loadAdminBalance = () => api.adminWallet.balance().then((r) => setAdminBalance(r.balance)).catch(() => {});
  useEffect(() => { loadAdminBalance(); }, []);

  const lookup = async () => {
    setError(null); setInfo(null); setReceiver(null);
    if (!code.trim()) { setError('Enter a User Id.'); return; }
    setLooking(true);
    try { const { user } = await api.fundTransfer.lookup(code.trim()); setReceiver(user); }
    catch (e) { setError(e.message); } finally { setLooking(false); }
  };

  const submit = async () => {
    setError(null); setInfo(null);
    if (!receiver) { setError('Look up a valid User Id first.'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    if (!txnPw) { setError('Enter your transaction password.'); return; }
    setSubmitting(true);
    try {
      const { row } = await api.fundTransfer.create({ userId: receiver.id, amount: amt, remark, txnType, transactionPassword: txnPw });
      setInfo(`${txnType === 'debit' ? 'Debited' : 'Credited'} ${money(amt)} — ${receiver.name}'s new balance ${money(row.updated_balance)}.`);
      setAmount(''); setRemark(''); setTxnPw('');
      setReceiver({ ...receiver, walletBalance: row.updated_balance });
      loadAdminBalance(); // your own wallet moved opposite to the receiver's
    } catch (e) { setError(e.message); } finally { setSubmitting(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>Transfer Funds</Text>
        {adminBalance !== null ? <Text style={styles.balancePill}>Your Wallet Balance: <Text style={{ fontWeight: '800' }}>{money(adminBalance)}</Text></Text> : null}
      </View>
      <Card>
        {info ? <Alert type="info">{info}</Alert> : null}
        {error ? <Alert type="error">{error}</Alert> : null}

        <Text style={styles.label}>User Id *</Text>
        <View style={styles.lookupRow}>
          <TextInput value={code} onChangeText={setCode} placeholder="Enter User Id (e.g. AEP0001)" placeholderTextColor={colors.muted}
            autoCapitalize="characters" style={[styles.input, { flex: 1 }]} onSubmitEditing={lookup} />
          <Button title="Lookup" onPress={lookup} loading={looking} style={{ minWidth: 110 }} />
        </View>

        {receiver ? (
          <View style={styles.receiver}>
            <Text style={styles.receiverTitle}>Receiver Details</Text>
            <Detail k="Retailer Name" v={receiver.name} />
            <Detail k="Shop Name" v={receiver.shopName || '—'} />
            <Detail k="User Id" v={receiver.userCode} />
            <Detail k="Mobile No" v={receiver.mobile} />
            <Detail k="User Balance" v={money(receiver.walletBalance)} />
          </View>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.field}><Text style={styles.label}>Amount *</Text>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="Enter amount" placeholderTextColor={colors.muted} style={styles.input} /></View>
          <View style={styles.field}><Text style={styles.label}>Remark</Text>
            <TextInput value={remark} onChangeText={setRemark} placeholder="Enter remark" placeholderTextColor={colors.muted} style={styles.input} /></View>
          <View style={styles.field}><Select label="Txn Type *" value={txnType} options={TXN_OPTIONS} onChange={setTxnType} searchable={false} /></View>
        </View>
        <View style={[styles.field, { maxWidth: 360 }]}><Text style={styles.label}>Transaction Password *</Text>
          <TextInput value={txnPw} onChangeText={setTxnPw} secureTextEntry placeholder="Your login password" placeholderTextColor={colors.muted} style={styles.input} /></View>

        <View style={{ flexDirection: 'row', marginTop: 16 }}>
          <Button title="SUBMIT" onPress={submit} loading={submitting} disabled={!receiver} style={{ minWidth: 180, paddingHorizontal: 24 }} />
        </View>
        <Text style={styles.hint}>Crediting a user debits your own wallet by the same amount (and debiting credits you back) — top up via Admin Wallet → Add Fund if your balance runs low. Use “All Fund Transfers” in the sidebar to see recent transfers. The transaction password is your admin login password (or your Transaction PIN, if set).</Text>
      </Card>
    </View>
  );
}

function Detail({ k, v }) {
  return <View style={styles.dRow}><Text style={styles.dKey}>{k}:</Text><Text style={styles.dVal}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  balancePill: { backgroundColor: colors.primarySoft || '#eef4ff', color: colors.primary, fontSize: 13, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.md, overflow: 'hidden' },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  lookupRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 6, marginBottom: 4 },
  receiver: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginVertical: 14, gap: 4 },
  receiverTitle: { color: colors.primary, fontWeight: '700', marginBottom: 6 },
  dRow: { flexDirection: 'row', gap: 8 },
  dKey: { color: colors.muted, width: 120, fontSize: 13.5 },
  dVal: { color: colors.text, fontWeight: '600', fontSize: 13.5, flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14, marginTop: 6 },
  field: { flexGrow: 1, flexBasis: '30%', minWidth: 220, gap: 6 },
  hint: { color: colors.muted, fontSize: 12.5, marginTop: 12 },
});
