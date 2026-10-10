import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Alert } from './UI';
import buttonLabel from './buttonLabel';
import { colors, radius } from '../theme';

// The bar at the top of every Add / Edit form: the heading on the left, then Save, Cancel and the "back to the list" button, with the
// error message under them. On the web it sticks to the top while the form scrolls, so Save and the error are always on screen
// (the old bottom buttons / error above the card went out of sight on long forms).
//   <FormBar heading="Edit Plan" saveTitle="Save" onSave={save} saving={saving} onCancel={...} backTitle="ALL PLANS" onBack={...} error={formError} />
// Leave out onCancel / backTitle / heading for the parts a screen does not have.
function Btn({ title, onPress, kind = 'outline', disabled }) {
  const [hover, setHover] = useState(false);
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={disabled ? undefined : onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} accessibilityRole="button"
      style={[styles.btn, primary ? { backgroundColor: hover && !disabled ? colors.primaryDark : colors.primary, borderColor: colors.primary } : { backgroundColor: hover && !disabled ? '#f1f5f9' : '#fff', borderColor: colors.border }, disabled && { opacity: 0.6 }]}
    >
      <Text style={[styles.btnText, { color: primary ? colors.onPrimary : colors.text }]}>{buttonLabel(title)}</Text>
    </Pressable>
  );
}

export default function FormBar({ heading, saveTitle = 'Save', onSave, saving = false, onCancel, backTitle, onBack, error }) {
  return (
    <View style={styles.sticky}>
      <View style={styles.row}>
        {heading ? <Text style={styles.heading} numberOfLines={1}>{heading}</Text> : null}
        <View style={{ flex: 1 }} />
        {saving ? <ActivityIndicator color={colors.primary} /> : null}
        {onSave ? <Btn kind="primary" title={saving ? 'Saving…' : saveTitle} onPress={onSave} disabled={saving} /> : null}
        {onCancel ? <Btn title="Cancel" onPress={onCancel} /> : null}
        {backTitle && onBack ? <Btn title={backTitle} onPress={onBack} /> : null}
      </View>
      {error ? <Alert type="error">{error}</Alert> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sticky: { gap: 8, paddingVertical: 8, ...Platform.select({ web: { position: 'sticky', top: 0, zIndex: 30, backgroundColor: colors.contentBg }, default: {} }) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text, flexShrink: 1 },
  btn: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontWeight: '700', fontSize: 13.5 },
});
