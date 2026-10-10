import React, { useEffect, useState } from 'react';
import { View, Text, Image, Platform, StyleSheet } from 'react-native';
import { api, assetUrl } from '../api/client';
import { colors } from '../theme';

// Company logo for the sidebar band: the Web Logo (native app: Mobile App Logo) uploaded in Application Settings ->
// Branding & Logos. Falls back to the Logo Icon + app name, then to an "A" badge + app name; a logo file that does
// not load falls back to the next option. Reads GET /api/settings/public once when it mounts.
export default function BrandLogo({ height = 34, maxWidth = 190 }) {
  const [brand, setBrand] = useState(null);
  const [failed, setFailed] = useState({}); // path -> true when the image did not load

  useEffect(() => {
    let alive = true;
    api.publicSettings().then((s) => { if (alive) setBrand(s.app || {}); }).catch(() => { if (alive) setBrand({}); });
    return () => { alive = false; };
  }, []);

  const b = brand || {};
  const name = b.appName || 'AEPS Portal';
  const main = (Platform.OS === 'web' ? b.webLogo : (b.mobileLogo || b.webLogo)) || null;
  const icon = b.logoIcon || null;
  const ok = (p) => p && !failed[p];
  const bad = (p) => () => setFailed((f) => ({ ...f, [p]: true }));

  if (ok(main)) {
    return <Image source={{ uri: assetUrl(main) }} onError={bad(main)} resizeMode="contain" style={{ height, width: maxWidth }} accessibilityLabel={name} />;
  }
  return (
    <View style={styles.row}>
      {ok(icon)
        ? <Image source={{ uri: assetUrl(icon) }} onError={bad(icon)} resizeMode="contain" style={{ width: height, height }} />
        : <View style={[styles.badge, { width: height, height, borderRadius: height * 0.26 }]}><Text style={[styles.badgeText, { fontSize: height * 0.5 }]}>{name.trim().charAt(0).toUpperCase() || 'A'}</Text></View>}
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
  badge: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontWeight: '800' },
  name: { color: colors.text, fontWeight: '800', fontSize: 16, letterSpacing: 0.2, flexShrink: 1 },
});
