import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Platform } from 'react-native';
import { Button } from './UI';
import { colors, radius, shadows } from '../theme';

const money = (v) => `₹${Number(v || 0).toFixed(2)}`;

// A printable "Customer Copy" receipt shown after a service txn (Success, or Processing while pending).
// `rows` = [[label, value], ...]; `receipt` may carry title/reference/balance.
export default function Receipt({ visible, onClose, title, rows = [], status = 'Success' }) {
  const print = () => { if (Platform.OS === 'web' && typeof window !== 'undefined') window.print(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
          <View style={styles.head}>
            <Text style={styles.brand}>AEPS Portal</Text>
            <View style={[styles.badge, status === 'Success' ? styles.ok : status === 'Processing' ? styles.wait : styles.bad]}><Text style={styles.badgeText}>{status}</Text></View>
          </View>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.table}>
            {rows.map(([k, v], i) => (
              <View key={k} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                <Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text>
              </View>
            ))}
          </View>
          {status === 'Processing' ? (
            <Text style={styles.pending}>The operator has not confirmed this yet. The amount stays on hold; if it fails, it is refunded to your wallet automatically. Check Service Report for the final status.</Text>
          ) : null}
          <Text style={styles.note}>This is a computer-generated receipt and does not require a signature.</Text>
          <View style={styles.actions}>
            <Button title="Print" variant="ghost" onPress={print} style={{ flex: 1 }} />
            <Button title="Done" onPress={onClose} style={{ flex: 1 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export { money };

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 20, width: '100%', maxWidth: 460, ...shadows.pop },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  brand: { fontSize: 18, fontWeight: '800', color: colors.primary, letterSpacing: -0.3 },
  badge: { borderRadius: 20, paddingVertical: 3, paddingHorizontal: 12 },
  ok: { backgroundColor: colors.successBg }, bad: { backgroundColor: colors.dangerBg }, wait: { backgroundColor: colors.warningBg },
  pending: { color: colors.warning, fontSize: 12, textAlign: 'center', marginTop: 12, lineHeight: 17 },
  badgeText: { fontWeight: '800', fontSize: 12, color: colors.text },
  title: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 12, textAlign: 'center' },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  trAlt: { backgroundColor: '#f8fafc' },
  k: { flex: 1, padding: 10, fontSize: 12.5, fontWeight: '700', color: '#475569' },
  v: { flex: 1.3, padding: 10, fontSize: 12.5, color: colors.text },
  note: { color: colors.muted, fontSize: 11, textAlign: 'center', marginVertical: 12 },
  actions: { flexDirection: 'row', gap: 12 },
});
