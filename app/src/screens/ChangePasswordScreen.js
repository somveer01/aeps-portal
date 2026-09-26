import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button, TextField, Alert } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

export default function ChangePasswordScreen({ onDone }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null); setDone(false);
    if (next.length < 8) { setError('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setError('New password and confirmation do not match'); return; }
    setLoading(true);
    try {
      await api.account.changePassword({ currentPassword: cur, newPassword: next, confirmPassword: confirm });
      setDone(true); setCur(''); setNext(''); setConfirm('');
      // Password change revokes the current session — force re-login with the new password.
      if (onDone) setTimeout(() => onDone(), 1500);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}><Text style={styles.headerText}>Change Password</Text></View>
        <View style={styles.body}>
          {error ? <Alert type="error">{error}</Alert> : null}
          {done ? <Alert type="success">Password changed. Signing you out — please log in with your new password…</Alert> : null}
          <Text style={styles.label}>Current Password <Text style={styles.req}>*</Text></Text>
          <TextField value={cur} onChangeText={setCur} placeholder="Enter current password" secureTextEntry />
          <Text style={[styles.label, { marginTop: 12 }]}>New Password <Text style={styles.req}>*</Text></Text>
          <TextField value={next} onChangeText={setNext} placeholder="At least 8 characters" secureTextEntry />
          <Text style={[styles.label, { marginTop: 12 }]}>Confirm New Password <Text style={styles.req}>*</Text></Text>
          <TextField value={confirm} onChangeText={setConfirm} placeholder="Re-enter new password" secureTextEntry onSubmitEditing={submit} />
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
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  req: { color: colors.danger },
});
