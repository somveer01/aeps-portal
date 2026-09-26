import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button, TextField, Alert } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

export default function TxnPinScreen() {
  const [cur, setCur] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null); setDone(false);
    if (!/^\d{4,6}$/.test(pin)) { setError('PIN must be 4–6 digits'); return; }
    if (pin !== confirm) { setError('PIN and confirmation do not match'); return; }
    setLoading(true);
    try {
      await api.account.setTxnPin({ currentPassword: cur, pin, confirmPin: confirm });
      setDone(true); setCur(''); setPin(''); setConfirm('');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}><Text style={styles.headerText}>Set Transaction PIN</Text></View>
        <View style={styles.body}>
          {error ? <Alert type="error">{error}</Alert> : null}
          {done ? <Alert type="success">Transaction PIN saved. Use it to authorize fund transfers.</Alert> : null}
          <Text style={styles.hint}>Once set, this PIN (not your login password) authorizes money actions like fund transfers.</Text>
          <Text style={styles.label}>Current Password <Text style={styles.req}>*</Text></Text>
          <TextField value={cur} onChangeText={setCur} placeholder="Enter account password" secureTextEntry />
          <Text style={[styles.label, { marginTop: 12 }]}>New Transaction PIN <Text style={styles.req}>*</Text></Text>
          <TextField value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} placeholder="4–6 digits" secureTextEntry keyboardType="numeric" maxLength={6} />
          <Text style={[styles.label, { marginTop: 12 }]}>Confirm PIN <Text style={styles.req}>*</Text></Text>
          <TextField value={confirm} onChangeText={(v) => setConfirm(v.replace(/\D/g, ''))} placeholder="Re-enter PIN" secureTextEntry keyboardType="numeric" maxLength={6} onSubmitEditing={submit} />
          <View style={{ marginTop: 16 }}>
            <Button title="Submit" onPress={submit} loading={loading} variant="navy" />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start' },
  card: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { backgroundColor: colors.primary, paddingVertical: 18, paddingHorizontal: 20 },
  headerText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  body: { padding: 20, gap: 8 },
  hint: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  req: { color: colors.danger },
});
