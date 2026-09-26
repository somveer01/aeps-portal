import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Icon from '../../components/Icon';
import { Card } from '../../components/UI';
import { api } from '../../api/client';
import { colors, radius, shadows } from '../../theme';

export default function ServicesScreen({ onOpen }) {
  const [tab, setTab] = useState('b2b');
  const [cat, setCat] = useState({ b2b: [], online: [] });
  useEffect(() => { api.retailer.catalogue().then(setCat).catch(() => {}); }, []);
  const tiles = tab === 'b2b' ? cat.b2b : cat.online;

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.tabs}>
        <Tab label="B2B Services" active={tab === 'b2b'} onPress={() => setTab('b2b')} />
        <Tab label="Online Services" active={tab === 'online'} onPress={() => setTab('online')} />
      </View>
      <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
        <View style={styles.grid}>
          {tiles.map((t) => (
            <ServiceTile key={t.key} tile={t} onPress={() => onOpen(t.route, t.title)} />
          ))}
        </View>
      </Card>
    </View>
  );
}

function Tab({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ServiceTile({ tile, onPress }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={[styles.tile, hover && styles.tileHover]}>
      <View style={styles.tileIcon}><Icon name={tile.icon} size={26} color={colors.primary} /></View>
      <Text style={styles.tileLabel} numberOfLines={2}>{tile.title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 10 },
  tab: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary, ...shadows.sm },
  tabText: { fontWeight: '700', color: colors.text }, tabTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  tile: { width: 130, minHeight: 118, backgroundColor: '#fff', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', padding: 12, gap: 10, ...shadows.sm },
  tileHover: { transform: [{ translateY: -2 }], ...shadows.card },
  tileIcon: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tileLabel: { fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'center' },
});
