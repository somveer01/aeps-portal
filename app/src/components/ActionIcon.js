import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

// Row action buttons for the master / list screens: a small rounded button with a line icon, a soft tint and a
// hover state (web). One look everywhere instead of emoji. Usage: <ActionIcon name="edit" onPress={...} />.
const TONES = {
  edit: { fg: '#2563eb', bg: '#eff6ff', hover: '#dbeafe', label: 'Edit' },
  delete: { fg: '#dc2626', bg: '#fef2f2', hover: '#fee2e2', label: 'Delete' },
  view: { fg: '#475569', bg: '#f1f5f9', hover: '#e2e8f0', label: 'View' },
  fund: { fg: '#059669', bg: '#ecfdf5', hover: '#d1fae5', label: 'Fund wallet' },
  key: { fg: '#d97706', bg: '#fffbeb', hover: '#fef3c7', label: 'Reset password' },
};

function Glyph({ name, color }) {
  const p = { stroke: color, strokeWidth: 1.9, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'edit':
      return (<><Path d="M12 20h9" {...p} /><Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" {...p} /></>);
    case 'delete':
      return (<><Path d="M3 6h18" {...p} /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" {...p} /><Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...p} /><Path d="M10 11v6M14 11v6" {...p} /></>);
    case 'view':
      return (<><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" {...p} /><Circle cx="12" cy="12" r="3" {...p} /></>);
    case 'fund':
      return (<><Path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" {...p} /><Path d="M4 6v12a2 2 0 0 0 2 2h14v-4" {...p} /><Path d="M18 12a2 2 0 0 0 0 4h4v-4z" {...p} /></>);
    case 'key':
      return (<><Circle cx="7.5" cy="15.5" r="4.5" {...p} /><Path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2" {...p} /></>);
    default:
      return null;
  }
}

export default function ActionIcon({ name, onPress, disabled, label }) {
  const t = TONES[name] || TONES.view;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label || t.label}
      hitSlop={4}
      style={({ hovered, pressed }) => [styles.btn, { backgroundColor: hovered || pressed ? t.hover : t.bg }, disabled && { opacity: 0.4 }]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24"><Glyph name={name} color={t.fg} /></Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
