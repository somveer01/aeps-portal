import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, shadows } from '../theme';

// The active announcements as one cycling banner (admin dashboard and every user panel's dashboard). Renders nothing when there are none.
export default function NoticeBanner({ items }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!items || items.length <= 1) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 4000);
    return () => clearInterval(t);
  }, [items]);
  if (!items || items.length === 0) return null;
  const cur = items[idx % items.length];
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeIcon}>📢</Text>
      <Text style={styles.noticeText} numberOfLines={2}>{cur.message}</Text>
      {items.length > 1 ? <Text style={styles.noticeCount}>{(idx % items.length) + 1}/{items.length}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#bfdbfe', borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 18, ...shadows.sm },
  noticeIcon: { fontSize: 18 },
  noticeText: { flex: 1, color: colors.primaryDark, fontWeight: '600' },
  noticeCount: { color: colors.muted, fontSize: 12, fontWeight: '700' },
});
