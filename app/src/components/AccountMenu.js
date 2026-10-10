import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Icon from './Icon';
import Avatar from './Avatar';
import { colors, radius } from '../theme';

// Google-style account popover under the avatar chip: who you are, the wallet, and every account action.
//   profile: { fullName, photo, userTypeName, userCode, mobile, email }   balance: number | null
//   items: [{ key, label, icon, onPress }]   walletAction: { label, onPress } | null
const money = (v) => (v === null || v === undefined ? '₹0.00' : `₹${Number(v).toFixed(2)}`);

export default function AccountMenu({ visible, onClose, profile, balance, onRefresh, walletAction, items, onManage, onLogout }) {
  const { width } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const p = profile || {};
  const cardW = Math.min(360, width - 24);

  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };
  const run = (fn) => () => { onClose(); if (fn) fn(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* The inner Pressable swallows taps so only the backdrop closes the popover. */}
        <Pressable style={[styles.card, { width: cardW }]} onPress={() => {}}>
          <ScrollView style={{ maxHeight: '100%' }} showsVerticalScrollIndicator={false}>
            <View style={styles.head}>
              <Avatar photo={p.photo} name={p.fullName} size={72} />
              <Text style={styles.name} numberOfLines={1}>{p.fullName || '—'}</Text>
              <View style={styles.rolePill}><Text style={styles.roleText}>{p.userTypeName || p.role || ''}</Text></View>
              <Text style={styles.sub} numberOfLines={1}>{[p.userCode, p.mobile].filter(Boolean).join('  ·  ')}</Text>
              {p.email ? <Text style={styles.sub} numberOfLines={1}>{p.email}</Text> : null}
              <Pressable onPress={run(onManage)} style={({ hovered }) => [styles.manage, hovered && { backgroundColor: '#f1f5f9' }]}>
                <Text style={styles.manageText}>Manage your account</Text>
              </Pressable>
            </View>

            <View style={styles.wallet}>
              <View style={{ flex: 1 }}>
                <Text style={styles.walletLabel}>WALLET BALANCE</Text>
                <Text style={styles.walletAmt}>{money(balance)}</Text>
              </View>
              {onRefresh ? (
                <Pressable onPress={refresh} hitSlop={8} style={styles.walletBtn} accessibilityLabel="Refresh balance">
                  <Icon name="refresh" size={16} color="#fff" />
                </Pressable>
              ) : null}
              {walletAction ? (
                <Pressable onPress={run(walletAction.onPress)} style={styles.walletAdd}>
                  <Icon name="plus" size={14} color={colors.primary} /><Text style={styles.walletAddText}>{walletAction.label}</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.list}>
              {(items || []).map((it) => (
                <Pressable key={it.key} onPress={run(it.onPress)} style={({ hovered }) => [styles.row, hovered && { backgroundColor: '#f1f5f9' }]}>
                  <View style={styles.rowIcon}><Icon name={it.icon} size={17} color={colors.primary} /></View>
                  <Text style={styles.rowText}>{it.label}</Text>
                  <Icon name="chevron" size={15} color="#94a3b8" />
                </Pressable>
              ))}
              <View style={styles.divider} />
              <Pressable onPress={run(onLogout)} style={({ hovered }) => [styles.row, hovered && { backgroundColor: '#fef2f2' }]}>
                <View style={[styles.rowIcon, { backgroundColor: '#fef2f2' }]}><Icon name="logout" size={17} color={colors.danger} /></View>
                <Text style={[styles.rowText, { color: colors.danger }]}>Sign out</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.18)' },
  card: {
    position: 'absolute', top: 54, right: 12, maxHeight: '88%', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border, shadowColor: '#0f172a', shadowOpacity: 0.22, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 10,
  },
  head: { alignItems: 'center', paddingTop: 22, paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  name: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 8, maxWidth: '100%' },
  rolePill: { backgroundColor: '#eef2ff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  roleText: { color: colors.primary, fontSize: 11.5, fontWeight: '700', textTransform: 'capitalize' },
  sub: { color: colors.muted, fontSize: 12.5, maxWidth: '100%' },
  manage: { marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 20 },
  manageText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  wallet: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14 },
  walletLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 },
  walletAmt: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  walletBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
  walletAdd: { height: 32, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 16, flexShrink: 0 },
  walletAddText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  list: { paddingVertical: 6, paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 14 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6, marginHorizontal: 6 },
});
