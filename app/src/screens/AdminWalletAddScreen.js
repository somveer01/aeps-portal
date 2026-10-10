import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button, TextField, Select, Alert } from '../components/UI';
import ConfirmDialog from '../components/ConfirmDialog';
import { api } from '../api/client';
import { colors, radius } from '../theme';

const TXN_OPTIONS = [{ label: 'Credit', value: 'credit' }, { label: 'Debit', value: 'debit' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;

export default function AdminWalletAddScreen() {
  const [amount, setAmount] = useState('');
  const [txnType, setTxnType] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [balance, setBalance] = useState(null);

  const loadBalance = () => api.adminWallet.balance().then((r) => setBalance(r.balance)).catch(() => {});
  useEffect(() => { loadBalance(); }, []);

  const [confirm, setConfirm] = useState(false); // "Credit ₹X to your wallet?" dialog
  const submit = () => {
    setError(null); setDone(null);
    if (!(Number(amount) > 0)) { setError('Enter a valid amount.'); return; }
    if (!txnType) { setError('Choose the transaction type.'); return; }
    if (!remark.trim()) { setError('Enter a remark.'); return; }
    setConfirm(true);
  };
  const doSubmit = async () => {
    setConfirm(false); setLoading(true);
    try {
      const r = await api.adminWallet.add({ amount: Number(amount), txnType, remark: remark.trim() });
      setDone(`Wallet updated. New balance: ${money(r.balance)}`);
      setBalance(r.balance);
      setAmount(''); setTxnType(''); setRemark('');
    } catch (e) { setError(e.message); } finally { setLoading(false); setConfirm(false); }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.headerText}>Add Funds to Your Admin Wallet</Text>
          {balance !== null ? <Text style={styles.headerBal}>Balance: {money(balance)}</Text> : null}
        </View>
        <View style={styles.body}>
          {error ? <Alert type="error">{error}</Alert> : null}
          {done ? <Alert type="success">{done}</Alert> : null}
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Amount <Text style={styles.req}>*</Text></Text>
              <TextField value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} placeholder="Enter Amount" keyboardType="numeric" />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Txn Type <Text style={styles.req}>*</Text></Text>
              <Select value={txnType} options={TXN_OPTIONS} onChange={setTxnType} placeholder="-- Select --" searchable={false} />
            </View>
          </View>
          <Text style={[styles.label, { marginTop: 14 }]}>Remark <Text style={styles.req}>*</Text></Text>
          <TextField value={remark} onChangeText={setRemark} placeholder="Enter remark" onSubmitEditing={submit} />
          <View style={{ marginTop: 16, alignSelf: 'flex-start' }}>
            <Button title="Submit" onPress={submit} loading={loading} variant="navy" />
          </View>
        </View>
      </View>
      <ConfirmDialog
        visible={confirm} danger={txnType === 'debit'} title={txnType === 'debit' ? 'Confirm Debit' : 'Confirm Credit'}
        message={`${txnType === 'debit' ? 'Debit' : 'Credit'} ${money(amount)} ${txnType === 'debit' ? 'from' : 'to'} your admin wallet?`}
        confirmText={txnType === 'debit' ? 'Debit Now' : 'Credit Now'} loading={loading} onConfirm={doSubmit} onCancel={() => setConfirm(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  card: { width: '100%', backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { backgroundColor: colors.primary, paddingVertical: 18, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  headerText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerBal: { color: '#fff', fontSize: 14, fontWeight: '700', opacity: 0.95 },
  body: { padding: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  col: { flexGrow: 1, flexBasis: '45%', minWidth: 220, gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  req: { color: colors.danger },
});
