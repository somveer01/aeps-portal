import React from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import Icon from './Icon';
import Avatar from './Avatar';
import BrandLogo from './BrandLogo';
import MenuSearch from './MenuSearch';
import { colors, shadows, isHex } from '../theme';

// Modern light header shared by every panel (admin, distributor, retailer ...): a thin accent line in the theme colours,
// the menu search on the left, and on the right the wallet pill and the account chip. Everything coloured follows the
// theme (Application Settings -> Primary / Secondary), so it matches the logo once the admin sets those colours.
// On narrow screens the sidebar is a drawer, so the header shows the menu button and the company logo instead.
export const TOPBAR_HEIGHT = 60; // the sidebar logo band uses the same height

function tint(hex, a) {
  if (!isHex(hex)) return `rgba(37,99,235,${a})`;
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export default function TopBar({ isWide, onMenu, menu, onSearchSelect, walletAmount, onWallet, photo, name, role, onUser }) {
  // activeBg = the secondary colour unless it is too light to see (then the primary), so the line never disappears.
  const accent = Platform.OS === 'web' && colors.activeBg !== colors.primary
    ? { backgroundImage: `linear-gradient(90deg, ${colors.primary}, ${colors.activeBg})` }
    : { backgroundColor: colors.primary };

  return (
    <View style={styles.wrap}>
      <View style={[styles.accent, accent]} />
      <View style={styles.row}>
        {!isWide ? (
          <Pressable onPress={onMenu} style={styles.menuBtn} accessibilityLabel="Open menu"><Text style={styles.menuIcon}>☰</Text></Pressable>
        ) : null}
        {!isWide ? <BrandLogo height={30} maxWidth={120} /> : null}
        {isWide ? <MenuSearch menu={menu} onSelect={onSearchSelect} variant="sidebar" style={styles.search} /> : null}
        <View style={{ flex: 1 }} />

        <Pressable onPress={onWallet} accessibilityLabel="Wallet balance"
          style={({ hovered }) => [styles.pill, { backgroundColor: tint(colors.primary, hovered ? 0.16 : 0.09), borderColor: tint(colors.primary, 0.22) }]}>
          <Icon name="wallet" size={17} color={colors.primary} />
          {isWide ? <Text style={styles.pillLabel}>Wallet</Text> : null}
          <Text style={[styles.pillAmt, { color: colors.primary }]}>{walletAmount}</Text>
        </Pressable>

        <Pressable onPress={onUser} accessibilityLabel="Account menu"
          style={({ hovered }) => [styles.chip, hovered && { backgroundColor: colors.surfaceAlt }]}>
          <Avatar photo={photo} name={name} size={34} />
          {isWide ? (
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.chipName} numberOfLines={1}>{name}</Text>
              {role ? <Text style={styles.chipRole} numberOfLines={1}>{role}</Text> : null}
            </View>
          ) : null}
          <Text style={styles.caret}>▾</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border, zIndex: 10, ...shadows.sm },
  accent: { height: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: TOPBAR_HEIGHT - 3, paddingHorizontal: 20 },
  menuBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  menuIcon: { fontSize: 20, color: colors.text, marginTop: -2 },
  search: { flex: 1, maxWidth: 460 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1 },
  pillLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  pillAmt: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: 240, paddingVertical: 4, paddingLeft: 4, paddingRight: 12, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  chipName: { color: colors.text, fontWeight: '700', fontSize: 13.5 },
  chipRole: { color: colors.muted, fontSize: 11, textTransform: 'capitalize', marginTop: 1 },
  caret: { color: colors.muted, fontSize: 12 },
});
