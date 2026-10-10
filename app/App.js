import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, onSessionEnded } from './src/api/client';
import { saveToken, clearToken, getThemeCache, setThemeCache } from './src/api/storage';
import { colors, applyTheme } from './src/theme';

// Web (desktop) only: render the whole app ~15% more compact, so 100% browser
// zoom shows the density that used to need 85%. Chromium/Safari honour `zoom`.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.style.zoom = '0.85';
}

// Simple auth state machine: booting -> login -> otp -> app.
// The theme is applied BEFORE any screen is required, so screen StyleSheets
// pick up the admin's chosen primary/secondary colors.
export default function App() {
  const [themeReady, setThemeReady] = useState(false);
  const [stage, setStage] = useState('booting');
  const [pending, setPending] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      // 1) Apply theme first (cache, else fetch from server) before screens load.
      let theme = await getThemeCache();
      if (!theme) {
        try {
          const s = await api.publicSettings();
          if ((s.theme?.primary && s.theme?.secondary) || s.theme?.layout) theme = s.theme;
        } catch {}
      }
      if (theme) { applyTheme(theme); setThemeCache(theme); }
      setThemeReady(true);

      // Keep the cache fresh for next launch.
      api.publicSettings().then((s) => {
        if ((s.theme?.primary && s.theme?.secondary) || s.theme?.layout) setThemeCache(s.theme);
      }).catch(() => {});

      // 2) Restore session.
      try {
        const { user } = await api.me();
        setUser(user);
        setStage('app');
      } catch {
        setStage('login');
      }
    })();
  }, []);

  const handleVerified = async ({ accessToken, user }) => {
    await saveToken(accessToken);
    setUser(user);
    setPending(null);
    setStage('app');
  };

  const handleLogout = async () => {
    await clearToken();
    setUser(null);
    setStage('login');
  };

  // Blocked by the admin (or session revoked): any API call answering 401 INACTIVE / TOKEN_REVOKED signs out,
  // and while the app is open a quiet check every 30 s makes it happen even if the user does nothing.
  useEffect(() => {
    onSessionEnded(handleLogout);
    if (stage !== 'app') return undefined;
    const t = setInterval(() => { api.me().catch(() => {}); }, 30000);
    return () => clearInterval(t);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  let content;
  if (!themeReady || stage === 'booting') {
    content = <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  } else {
    // Require screens now (after applyTheme) so their StyleSheets use the theme.
    const LoginScreen = require('./src/screens/LoginScreen').default;
    const OtpScreen = require('./src/screens/OtpScreen').default;

    if (stage === 'login') {
      content = <LoginScreen onPending={(p) => { setPending(p); setStage('otp'); }} />;
    } else if (stage === 'otp') {
      content = <OtpScreen pending={pending} onVerified={handleVerified} onCancel={() => { setPending(null); setStage('login'); }} />;
    } else if (user && user.mustChangePassword) {
      // The admin reset this password: nothing else opens until the user chooses their own (the API enforces it too).
      const ChangePasswordScreen = require('./src/screens/ChangePasswordScreen').default;
      content = (
        <View style={styles.forced}>
          <View style={styles.forcedBox}><ChangePasswordScreen forced onDone={handleLogout} onCancel={handleLogout} /></View>
        </View>
      );
    } else if (user && user.role === 'admin') {
      const DashboardScreen = require('./src/screens/DashboardScreen').default;
      content = <DashboardScreen user={user} onLogout={handleLogout} />;
    } else {
      // Managed users (retailers/distributors/employees) get the retailer panel.
      const RetailerShell = require('./src/screens/RetailerShell').default;
      content = <RetailerShell user={user} onLogout={handleLogout} />;
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  forced: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: colors.bg },
  forcedBox: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sidebar },
});
