import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { assetUrl } from '../api/client';
import { colors } from '../theme';

export function initialsOf(nameOrUser) {
  const n = typeof nameOrUser === 'string' ? nameOrUser : (nameOrUser && (nameOrUser.fullName || nameOrUser.username)) || '';
  const parts = String(n).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Profile picture (an /uploads/... path) or, without one, the initials on a colored disc.
// light: white disc with colored initials (used on the blue topbar).
export default function Avatar({ photo, name, size = 30, light = false, border = false }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  const ring = border ? { borderWidth: 3, borderColor: '#fff' } : null;
  if (photo) return <Image source={{ uri: assetUrl(photo) }} style={[styles.img, box, ring]} resizeMode="cover" />;
  return (
    <View style={[styles.disc, box, ring, { backgroundColor: light ? colors.onPrimary : colors.primary }]}>
      <Text style={{ color: light ? colors.primary : colors.onPrimary, fontWeight: '800', fontSize: Math.max(11, Math.round(size * 0.38)) }}>{initialsOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: '#e2e8f0' },
  disc: { alignItems: 'center', justifyContent: 'center' },
});
