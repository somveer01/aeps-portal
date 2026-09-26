import React from 'react';
import { View, Text } from 'react-native';
import { Card, Button } from '../../components/UI';
import { colors } from '../../theme';

export default function SimplePage({ title, note, onBack }) {
  return (
    <Card>
      {onBack ? <View style={{ marginBottom: 12 }}><Button title="‹ Back" variant="ghost" onPress={onBack} style={{ alignSelf: 'flex-start' }} /></View> : null}
      <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 8 }}>{title}</Text>
      <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{note}</Text>
    </Card>
  );
}
