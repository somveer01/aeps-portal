import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button, TextField, Alert } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

export default function AadhaarVerifyScreen() {
  const [aadhaar, setAadhaar] = useState('');
  const [txnPw, setTxnPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setError(null); setResult(null); setLoading(true);
    try {
      const r = await api.verify.aadhaar(aadhaar.replace(/\D/g, ''), txnPw);
      setResult(r);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}><Text style={styles.headerText}>Verify Aadhaar No</Text></View>
        <View style={styles.body}>
          {error ? <Alert type="error">{error}</Alert> : null}
          {result ? <Alert type="success">{result.message} (Ref: {result.refId})</Alert> : null}
          <Text style={styles.label}>Aadhar Number <Text style={styles.req}>*</Text></Text>
          <TextField value={aadhaar} onChangeText={(v) => setAadhaar(v.replace(/\D/g, ''))} placeholder="Enter 12 Digit Aadhaar No" keyboardType="numeric" maxLength={12} autoFocus />
          <Text style={[styles.label, { marginTop: 12 }]}>Transaction Password <Text style={styles.req}>*</Text></Text>
          <TextField value={txnPw} onChangeText={setTxnPw} placeholder="Transaction Password" secureTextEntry onSubmitEditing={submit} />
          <View style={{ marginTop: 16 }}>
            <Button title="Send OTP" onPress={submit} loading={loading} variant="navy" />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start' },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { backgroundColor: colors.primary, paddingVertical: 18, paddingHorizontal: 20 },
  headerText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  body: { padding: 20, gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  req: { color: colors.danger },
});
