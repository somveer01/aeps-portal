import React from 'react';
import { View, Text, Modal, StyleSheet } from 'react-native';
import { Button } from './UI';
import { colors, radius } from '../theme';

// "Are you sure?" dialog for anything that cannot be undone (delete / remove). Same look as the Delete confirmations on the master screens.
//   <ConfirmDialog visible={!!target} title="Delete Plan" message={<>Delete <Text style={{fontWeight:'700'}}>Gold</Text>? This cannot be undone.</>}
//                  confirmText="Delete" loading={busy} onConfirm={...} onCancel={() => setTarget(null)} />
// `message` may be a string or a node. `danger` (default true) paints the confirm button red.
export default function ConfirmDialog({ visible, title = 'Are you sure?', message, confirmText = 'Delete', cancelText = 'Cancel', danger = true, loading = false, onConfirm, onCancel }) {
  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alertdialog">
          <Text style={styles.title}>{title}</Text>
          {typeof message === 'string' ? <Text style={styles.para}>{message}</Text> : message}
          <View style={styles.actions}>
            <Button title={cancelText} variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
            <Button title={confirmText} onPress={onConfirm} loading={loading} style={[{ flex: 1 }, danger && { backgroundColor: colors.danger }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 440, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  para: { color: colors.text, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 6 },
});
