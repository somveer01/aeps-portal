import React from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import Icon from './Icon';
import Avatar from './Avatar';
import BrandLogo from './BrandLogo';
import MenuSearch from './MenuSearch';
import { colors, shadows } from '../theme';

// Header shared by every panel (admin, distributor, retailer ...). It is painted in the theme Primary colour (a soft gradient
// to a darker shade), so whatever Primary / Secondary the admin saves in Application Settings changes the whole look, and the
// text / pills use colors.onPrimary so they stay readable on light and dark primaries alike.
// On narrow screens the sidebar is a drawer, so the header shows the menu button and the company logo (on a white chip).
export const TOPBAR_HEIGHT = 60; // the sidebar logo band uses the same height

const on = colors.onPrimary; // '#ffffff' or near-black
const glass = (a) => (on === '#ffffff' ? `rgba(255,255,255,${a})` : `rgba(15,23,42,${a * 0.6})`);

export default function TopBar({ isWide, onMenu, menu, onSearchSelect, walletAmount, onWallet, photo, name, role, onUser }) {
  const bg = Platform.OS === 'web'
    ? { backgroundImage: `linear-gradient(100deg, ${colors.primary} 0%, ${colors.primary} 55%, ${colors.primaryDark} 100%)` }
    : { backgroundColor: colors.primary };

  return (
    <View style={[styles.wrap, bg]}>
      <View style={styles.row}>
        {!isWide ? (
          <Pressable onPress={onMenu} style={styles.menuBtn} accessibilityLabel="Open menu"><Text style={styles.menuIcon}>☰</Text></Pressable>
        ) : null}
        {!isWide ? <View style={styles.logoChip}><BrandLogo height={28} maxWidth={110} /></View> : null}
        {isWide ? <MenuSearch menu={menu} onSelect={onSearchSelect} variant="topbar" style={styles.search} /> : null}
        <View style={{ flex: 1 }} />

        <Pressable onPress={onWallet} accessibilityLabel="Wallet balance"
          style={({ hovered }) => [styles.pill, { backgroundColor: glass(hovered ? 0.26 : 0.18) }]}>
          <Icon name="wallet" size={17} color={on} />
          {isWide ? <Text style={styles.pillLabel}>Wallet</Text> : null}
          <Text style={styles.pillAmt}>{walletAmount}</Text>
        </Pressable>

        <Pressable onPress={onUser} accessibilityLabel="Account menu"
          style={({ hovered }) => [styles.chip, { backgroundColor: glass(hovered ? 0.26 : 0.18) }]}>
          <Avatar photo={photo} name={name} size={34} light />
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
  wrap: { zIndex: 10, ...shadows.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: TOPBAR_HEIGHT, paddingHorizontal: 20 },
  menuBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: glass(0.18) },
  menuIcon: { fontSize: 20, color: on, marginTop: -2 },
  logoChip: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, height: 38, justifyContent: 'center' },
  search: { flex: 1, maxWidth: 460 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 14, borderRadius: 19 },
  pillLabel: { color: on, opacity: 0.85, fontSize: 12, fontWeight: '700' },
  pillAmt: { color: on, fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: 240, paddingVertical: 4, paddingLeft: 4, paddingRight: 12, borderRadius: 24 },
  chipName: { color: on, fontWeight: '700', fontSize: 13.5 },
  chipRole: { color: on, opacity: 0.8, fontSize: 11, textTransform: 'capitalize', marginTop: 1 },
  caret: { color: on, opacity: 0.85, fontSize: 12 },
});
