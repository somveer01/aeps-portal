import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import Avatar from './Avatar';
import MenuSearch from './MenuSearch';
import { api } from '../api/client';
import { colors, shadows } from '../theme';
import { MODERN_HEADER_HEIGHT } from './ModernSidebar';

// Header of the "Modern" layout (white): sidebar toggle, a two-line label (app name + the API mode, mock or live),
// the wallet pill, a settings shortcut and the account chip. Colours that are not neutral follow the theme Primary.
// menu / onSearchSelect / showSearch: while the sidebar is collapsed (no search box there) the header carries the menu search.
export default function ModernHeader({ isWide, onToggle, appName, balanceText, onWallet, onSettings, name, role, photo, onUser, menu, onSearchSelect, showSearch }) {
  const [mode, setMode] = useState(null); // 'mock' | 'live'
  useEffect(() => { api.health().then((h) => setMode(h && h.mode)).catch(() => {}); }, []);
  const live = mode === 'live';

  return (
    <View style={styles.bar}>
      <Pressable onPress={onToggle} style={({ hovered }) => [styles.iconBtn, hovered && styles.hover]} accessibilityLabel="Toggle menu">
        <Icon name="menu" size={22} color="#334155" />
      </Pressable>
      {isWide ? (
        <View style={{ gap: 1 }}>
          <Text style={[styles.l1, { color: colors.primary }]} numberOfLines={1}>{String(appName || 'AEPS Portal').toUpperCase()}</Text>
          <View style={styles.modeRow}>
            <View style={[styles.modeDot, { backgroundColor: mode ? (live ? '#16a34a' : '#d97706') : '#cbd5e1' }]} />
            <Text style={styles.l2}>{mode ? (live ? 'Live mode' : 'Mock mode') : 'Checking…'}</Text>
          </View>
        </View>
      ) : null}
      {showSearch && menu ? <MenuSearch menu={menu} onSelect={onSearchSelect} variant="sidebar" style={styles.search} /> : null}
      <View style={{ flex: 1 }} />

      <Pressable onPress={onWallet} accessibilityLabel="Wallet balance" style={({ hovered }) => [styles.wallet, { backgroundColor: colors.primary }, hovered && { opacity: 0.92 }]}>
        <View style={styles.walletIcon}><Icon name="wallet" size={15} color={colors.onPrimary} /></View>
        <Text style={[styles.walletText, { color: colors.onPrimary }]}>{balanceText}</Text>
      </Pressable>

      <Pressable onPress={onSettings} style={({ hovered }) => [styles.iconBtn, hovered && styles.hover]} accessibilityLabel="Application settings">
        <Icon name="settings" size={20} color="#64748b" />
      </Pressable>

      <Pressable onPress={onUser} style={({ hovered }) => [styles.user, hovered && styles.hover]} accessibilityLabel="Account menu">
        <Avatar photo={photo} name={name} size={36} />
        {isWide ? (
          <View style={{ maxWidth: 150 }}>
            <Text style={styles.userName} numberOfLines={1}>{name}</Text>
            {role ? <Text style={styles.userRole} numberOfLines={1}>{String(role).toUpperCase()}</Text> : null}
          </View>
        ) : null}
        <Icon name="chevron" size={14} color="#94a3b8" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14, height: MODERN_HEADER_HEIGHT, paddingHorizontal: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eef2f7', zIndex: 10, ...shadows.sm },
  search: { width: 300, marginLeft: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hover: { backgroundColor: '#f1f5f9' },
  l1: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.1 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modeDot: { width: 7, height: 7, borderRadius: 4 },
  l2: { fontSize: 12.5, color: '#64748b', fontWeight: '600' },
  wallet: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingLeft: 8, paddingRight: 16, borderRadius: 14, ...shadows.card },
  walletIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  walletText: { fontWeight: '800', fontSize: 14 },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 14 },
  userName: { color: '#0f172a', fontWeight: '800', fontSize: 13 },
  userRole: { color: '#6366f1', fontWeight: '800', fontSize: 10.5, letterSpacing: 0.8 },
});
