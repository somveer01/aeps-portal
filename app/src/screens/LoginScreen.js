import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ImageBackground, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Button, TextField, Alert, Logo } from '../components/UI';
import { api, assetUrl } from '../api/client';
import { colors, radius, shadows } from '../theme';

// Shown in the footer — change these to your real support details.
const SUPPORT_EMAIL = 'support@aepsportal.in';
const SUPPORT_PHONE = '+91 90000 00000';
const FEATURES = ['AEPS Cash Withdrawal', 'DMT · Recharge · BBPS', 'Micro ATM · CMS', 'Highest commission payouts'];

export default function LoginScreen({ onPending }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaId, setCaptchaId] = useState(null);
  const [captchaSvg, setCaptchaSvg] = useState(null);
  const [banner, setBanner] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadCaptcha = useCallback(async () => {
    setCaptcha('');
    try {
      const { captchaId, svg } = await api.getCaptcha();
      setCaptchaId(captchaId); setCaptchaSvg(svg);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { loadCaptcha(); }, [loadCaptcha]);
  useEffect(() => { api.publicSettings().then((s) => setBanner(assetUrl(s.loginBanner))).catch(() => {}); }, []);

  const submit = async () => {
    setError(null);
    if (!username || !password || !captcha) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    try {
      const res = await api.login({ username, password, captchaId, captcha });
      onPending(res);
    } catch (e) { setError(e.message); loadCaptcha(); } finally { setLoading(false); }
  };

  const DefaultBanner = (
    <View style={styles.bannerDefault}>
      <Text style={styles.bannerHeadline}>Your complete{'\n'}fintech services platform</Text>
      <View style={{ gap: 12, marginTop: 20 }}>
        {FEATURES.map((f) => (
          <View key={f} style={styles.featureRow}>
            <View style={styles.tick}><Text style={styles.tickText}>✓</Text></View>
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.loginBg }} contentContainerStyle={styles.page}>
      <View style={styles.wrap}>
        <View style={[styles.card, { flexDirection: isWide ? 'row' : 'column' }]}>
          {/* Left: customizable banner */}
          {isWide && (
            <View style={styles.bannerCol}>
              {banner ? (
                <ImageBackground source={{ uri: banner }} style={styles.bannerBg} resizeMode="cover" />
              ) : DefaultBanner}
            </View>
          )}

          {/* Right: form */}
          <View style={styles.formCol}>
            <View style={styles.brandRow}>
              <Logo size={40} />
              <Text style={styles.brand}>AEPS Portal</Text>
            </View>

            <Alert type="error">{error}</Alert>

            <TextField label="Username" value={username} onChangeText={setUsername} placeholder="admin" autoFocus={isWide} />
            <TextField label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />

            <View style={styles.captchaRow}>
              <View style={styles.captchaBox}>
                {captchaSvg ? <SvgXml xml={captchaSvg} width={130} height={44} /> : <Text style={{ color: colors.muted }}>…</Text>}
              </View>
              <Pressable onPress={loadCaptcha} style={({ hovered }) => [styles.reload, hovered && { backgroundColor: '#f1f5f9' }]}>
                <Text style={{ fontSize: 18 }}>↻</Text>
              </Pressable>
            </View>
            <TextField value={captcha} onChangeText={setCaptcha} placeholder="Enter the captcha" onSubmitEditing={submit} />

            <Pressable style={styles.forgot} onPress={() => setError('Password reset is not available yet.')}>
              <Text style={styles.forgotText}>Forgot Password ?</Text>
            </Pressable>

            <Button title="SUBMIT" variant="navy" onPress={submit} loading={loading} />

            <View style={styles.registerRow}>
              <Text style={styles.registerText}>Don't have an account yet? </Text>
              <Pressable onPress={() => setError('Registration is not available yet.')}>
                <Text style={styles.registerLink}>Register Here</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={[styles.footer, { flexDirection: isWide ? 'row' : 'column' }]}>
          <Text style={styles.footText}>Support Email: <Text style={styles.footStrong}>{SUPPORT_EMAIL}</Text></Text>
          <Text style={styles.footText}>Support Contact No: <Text style={styles.footStrong}>{SUPPORT_PHONE}</Text></Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  wrap: { width: '100%', maxWidth: 1000, gap: 14 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden',
    shadowColor: '#0f172a', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 6,
    boxShadow: '0 12px 40px rgba(15,23,42,0.14)',
  },

  bannerCol: { flex: 1.25, minHeight: 470 },
  bannerBg: { flex: 1 },
  bannerDefault: { flex: 1, backgroundColor: colors.sidebar, padding: 44, justifyContent: 'center', boxShadow: `inset -60px -80px 160px ${colors.primaryDark}55` },
  bannerHeadline: { color: '#fff', fontSize: 31, fontWeight: '800', lineHeight: 40, letterSpacing: -0.3 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  tick: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.sm },
  tickText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  featureText: { color: '#e2e8f0', fontSize: 15 },

  formCol: { flex: 1, padding: 38, gap: 14, justifyContent: 'center', minWidth: 300 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  brand: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },

  captchaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  captchaBox: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 8, height: 50, justifyContent: 'center', alignItems: 'center' },
  reload: { width: 50, height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },

  forgot: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { color: colors.navy, fontWeight: '700', fontSize: 13 },
  registerRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: 2 },
  registerText: { color: colors.muted },
  registerLink: { color: colors.primary, fontWeight: '700' },

  footer: { justifyContent: 'space-between', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  footText: { color: colors.text, fontSize: 13 },
  footStrong: { color: colors.primary, fontWeight: '700' },
});
