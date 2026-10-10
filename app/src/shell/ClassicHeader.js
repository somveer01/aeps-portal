import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import MenuSearch from '../components/MenuSearch';
import { colors, shadows } from '../theme';

// Topbar of the "Classic" layout for every panel: painted in the exact theme Primary (colors.topbarBg), with text, icons and the
// glass pills in colors.onBrand so a light Primary stays readable. admin: centred menu search; retailer: search next to the brand text.
const glass = (a) => (colors.onBrand === '#ffffff' ? `rgba(255,255,255,${a})` : `rgba(15,23,42,${a * 0.6})`);

export default function ClassicHeader({ panel, isWide, onMenu, brandText, menu, onSearchSelect, balanceText, onWallet, name, photo, onUser }) {
  const admin = panel === 'admin';
  return (
    <View style={[styles.topbar, admin ? styles.topbarAdmin : styles.topbarRetailer]}>
      {!isWide && (
        <Pressable onPress={onMenu} style={styles.hamburger}><Text style={{ fontSize: 22, color: colors.onBrand }}>☰</Text></Pressable>
      )}
      <Text style={[styles.brand, { fontSize: admin ? 17 : 15, letterSpacing: admin ? 0.3 : 0.2 }]} numberOfLines={admin ? undefined : 1}>{brandText}</Text>
      {admin ? <View style={{ flex: 1 }} /> : null}
      {isWide && <MenuSearch menu={menu} onSelect={onSearchSelect} variant="topbar" style={admin ? styles.searchAdmin : styles.searchRetailer} />}
      <View style={{ flex: 1 }} />
      {/* Wallet pill: always visible */}
      <Pressable style={[styles.walletPill, !admin && { marginRight: 8 }]} onPress={onWallet} accessibilityLabel="Wallet balance">
        <Icon name="wallet" size={16} color={colors.onBrand} />
        {isWide ? <Text style={styles.walletPillLabel}>Wallet</Text> : null}
        <Text style={styles.walletPillAmt}>{balanceText}</Text>
      </Pressable>
      <Pressable style={styles.userChip} onPress={onUser}>
        <Avatar photo={photo} name={name} size={30} light />
        {isWide ? <Text style={styles.userChipName} numberOfLines={1}>{name}</Text> : null}
        <Text style={{ color: colors.onBrand }}>▾</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.topbarBg, borderBottomWidth: 1, borderBottomColor: colors.brandBorder, paddingHorizontal: 18, zIndex: 10, ...shadows.card },
  topbarAdmin: { paddingVertical: 0, height: 48 },
  topbarRetailer: { paddingVertical: 12, minHeight: 58 },
  hamburger: { padding: 4 },
  brand: { color: colors.onBrand, fontWeight: '800' },
  searchAdmin: { width: 420, maxWidth: '45%', marginHorizontal: 12 },
  searchRetailer: { flex: 1, maxWidth: 420, marginLeft: 12 },
  walletPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: glass(0.18), borderRadius: 22, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: glass(0.22) },
  walletPillLabel: { color: colors.onBrand, opacity: 0.85, fontSize: 11.5, fontWeight: '700' },
  walletPillAmt: { color: colors.onBrand, fontWeight: '800', fontSize: 13.5 },
  userChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: glass(0.18), borderRadius: 22, paddingVertical: 5, paddingHorizontal: 8, maxWidth: 200, borderWidth: 1, borderColor: glass(0.22) },
  userChipName: { color: colors.onBrand, fontWeight: '600', flexShrink: 1 },
});
