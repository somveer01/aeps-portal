import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Icon from '../../components/Icon';
import { Card } from '../../components/UI';
import { api } from '../../api/client';
import { colors, radius, shadows } from '../../theme';

// Every service this user may use, as tiles in one list (no B2B / Online tabs): the catalogue is built from Service Master - switched on,
// has a Retailer screen, allowed for the user's type (Service Permissions).
export default function ServicesScreen({ onOpen }) {
  const [tiles, setTiles] = useState([]); const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.retailer.catalogue().then((c) => setTiles(c.tiles || [...(c.b2b || []), ...(c.online || [])])).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
        <View style={styles.grid}>
          {tiles.map((t) => (
            <ServiceTile key={t.key} tile={t} onPress={() => onOpen(t.route, t.title)} />
          ))}
          {loaded && !tiles.length ? <Text style={styles.empty}>No service is enabled for your account yet.</Text> : null}
        </View>
      </Card>
    </View>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  tile: { width: 130, minHeight: 118, backgroundColor: '#fff', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', padding: 12, gap: 10, ...shadows.sm },
  tileHover: { transform: [{ translateY: -2 }], ...shadows.card },
  tileIcon: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tileLabel: { fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'center' },
  empty: { color: '#fff', fontWeight: '600' },
});
