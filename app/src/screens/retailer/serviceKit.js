import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from '../../components/UI';
import { colors, radius } from '../../theme';

// Shared header for every service screen: colored title bar + Back button.
export function ServiceHeader({ title, onBack }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerText}>{title}</Text>
      {onBack ? <Button title="‹ Back to Services" variant="ghost" onPress={onBack} style={styles.back} /> : null}
    </View>
  );
}

export const formStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' },
  formCol: { flexGrow: 1, flexBasis: 340, minWidth: 300 },
  infoCol: { flexGrow: 1, flexBasis: 340, minWidth: 300 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  infoTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 12 },
});

const styles = StyleSheet.create({
  header: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 16, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  headerText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  back: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.3)' },
});
