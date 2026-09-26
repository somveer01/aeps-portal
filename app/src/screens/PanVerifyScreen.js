import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button, TextField, Alert } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

export default function PanVerifyScreen() {
  const [pan, setPan] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setError(null); setResult(null); setLoading(true);
    try {
      const r = await api.verify.pan(pan.trim().toUpperCase());
      setResult(r);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}><Text style={styles.headerText}>Verify PAN No</Text></View>
        <View style={styles.body}>
          {error ? <Alert type="error">{error}</Alert> : null}
          {result ? (
            <Alert type="success">
              PAN {result.panNumber} is {result.status}. {result.name ? `Name: ${result.name}.` : ''}
            </Alert>
          ) : null}
          <Text style={styles.label}>Pan Number <Text style={styles.req}>*</Text></Text>
          <TextField value={pan} onChangeText={(v) => setPan(v.toUpperCase())} placeholder="Enter 10 Digit Pan No" maxLength={10} autoFocus onSubmitEditing={submit} />
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
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { backgroundColor: colors.primary, paddingVertical: 18, paddingHorizontal: 20 },
  headerText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  body: { padding: 20, gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  req: { color: colors.danger },
});
