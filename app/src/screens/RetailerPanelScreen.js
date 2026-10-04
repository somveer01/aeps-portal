import React from 'react';
import { View, Text, StyleSheet, Pressable, Linking, Platform } from 'react-native';
import { Card, Button } from '../components/UI';
import { FioriPage, FioriPanel, FioriButton, FIORI } from '../components/Fiori';
import { colors, radius, shadows } from '../theme';

// B2B + Online services the retailer panel offers (see 02_spect_retailer_document.md).
const B2B = ['Mobile Recharge', 'DTH Recharge', 'Bill Payment (BBPS)', 'AEPS', 'Money Transfer (DMT)', 'Move To Bank', 'Aadhar Pay', 'Micro ATM', 'FASTag', 'UPI Collection', 'Fino CMS', 'LIC Payment', 'NSDL PAN Card', 'Gas Booking', 'Fund Request', 'Fund Transfer'];
const ONLINE = ['Flight Booking', 'Hotel Booking', 'Bus Booking'];

// Where the retailer panel lives. Once role-based routing lands, it is the same
// app origin; override by setting `retailer_panel_url` in app settings later.
function retailerUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) return window.location.origin;
  return 'http://localhost:8081';
}

export default function RetailerPanelScreen() {
  const open = () => { Linking.openURL(retailerUrl()).catch(() => {}); };

  return (
    <FioriPage>
      <FioriPanel>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>B2B AePS Retailer Panel</Text>
            <Text style={styles.sub}>
              The retailer-facing side of the platform — retailers (managed users) log in here to run
              AEPS, DMT, recharge, BBPS, bookings and more, and to manage their wallet & commission.
            </Text>
          </View>
          <FioriButton title="Open Retailer Panel" onPress={open} />
        </View>
        <View style={styles.noteRow}>
          <Text style={styles.noteLabel}>Spec & build plan</Text>
          <Text style={styles.note}>02_spect_retailer_document.md (in the project root) — phased, step-by-step.</Text>
        </View>
      </FioriPanel>

      <FioriPanel>
        <Text style={styles.section}>B2B Services</Text>
        <View style={styles.grid}>
          {B2B.map((s) => (
            <View key={s} style={styles.chip}><Text style={styles.chipText}>{s}</Text></View>
          ))}
        </View>
      </FioriPanel>

      <FioriPanel>
        <Text style={styles.section}>Online Services</Text>
        <View style={styles.grid}>
          {ONLINE.map((s) => (
            <View key={s} style={[styles.chip, styles.chipAlt]}><Text style={styles.chipText}>{s}</Text></View>
          ))}
        </View>
      </FioriPanel>
    </FioriPage>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 19, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  sub: { color: colors.muted, fontSize: 13.5, marginTop: 6, lineHeight: 20, maxWidth: 640 },
  noteRow: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  noteLabel: { fontSize: 11.5, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  note: { color: colors.text, fontSize: 13 },
  section: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#dbe6fb', borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 13, ...shadows.sm },
  chipAlt: { backgroundColor: '#fff7ed', borderColor: '#fed7aa' },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
