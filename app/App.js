import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api } from './src/api/client';
import { saveToken, clearToken, getThemeCache, setThemeCache } from './src/api/storage';
import { colors, applyTheme } from './src/theme';

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
          if (s.theme?.primary && s.theme?.secondary) theme = s.theme;
        } catch {}
      }
      if (theme) { applyTheme(theme); setThemeCache(theme); }
      setThemeReady(true);

      // Keep the cache fresh for next launch.
      api.publicSettings().then((s) => {
        if (s.theme?.primary && s.theme?.secondary) setThemeCache(s.theme);
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sidebar },
});
