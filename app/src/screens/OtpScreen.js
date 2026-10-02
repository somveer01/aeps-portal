import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Button, TextField, Alert, Card, Logo } from '../components/UI';
import { api } from '../api/client';
import { colors } from '../theme';

export default function OtpScreen({ pending, onVerified, onCancel }) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pendingToken, setPendingToken] = useState(pending.pendingToken);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async () => {
    setError(null); setInfo(null);
    if (!otp) { setError('Please enter the OTP.'); return; }
    setLoading(true);
    try {
      const res = await api.verifyOtp({ pendingToken, otp });
      onVerified(res); // { accessToken, user }
    } catch (e) {
      setError(e.message);
      if (e.code === 'MISMATCH') setOtp(''); // stay here: "Incorrect OTP. N attempts left."
      if (['NO_OTP', 'EXPIRED', 'TOO_MANY_ATTEMPTS'].includes(e.code)) {
        setTimeout(onCancel, 2000); // terminal states (incl. the last wrong attempt) -> back to login
      }
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null); setInfo(null);
    try {
      await api.resendOtp(pendingToken);
      setInfo('A new OTP has been sent.');
      setCooldown(30);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card style={styles.card}>
        <View style={styles.brand}>
          <Logo />
          <Text style={styles.title}>Two-step verification</Text>
        </View>

        <Alert type="info">{info}</Alert>
        <Alert type="error">{error}</Alert>

        <Text style={styles.note}>
          We sent a 6-digit code to <Text style={{ fontWeight: '700' }}>{pending.mobileMask}</Text>.
          It expires in {pending.otpTtlMinutes} minutes.
        </Text>

        <TextField
          label="Enter OTP"
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ''))}
          placeholder="______"
          keyboardType="number-pad"
          maxLength={8}
          autoFocus
          onSubmitEditing={verify}
        />

        <Button title="Verify & continue" onPress={verify} loading={loading} />
        <Button
          title={cooldown > 0 ? `Resend OTP (${cooldown}s)` : 'Resend OTP'}
          variant="ghost"
          onPress={cooldown > 0 ? undefined : resend}
          disabled={cooldown > 0}
        />
        <Pressable onPress={onCancel}><Text style={styles.cancel}>Cancel and start over</Text></Pressable>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, backgroundColor: colors.sidebar, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 400, gap: 12 },
  brand: { alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 6 },
  note: { color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: 4 },
  cancel: { color: colors.muted, textAlign: 'center', textDecorationLine: 'underline', marginTop: 6 },
});
