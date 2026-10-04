// Shared SAP Fiori building blocks for the admin screens (web/desktop).
// The page title is already shown by DashboardScreen, so FioriHeader carries
// only the item count + actions (no duplicate title).
import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput,
} from 'react-native';
import { shadows, colors } from '../theme';

// Structural tones stay Fiori-neutral; the accent (blue*) follows the app theme
// (colors.* is already themed before screens/StyleSheets load, see App.js).
export const FIORI = {
  bg: '#f5f6f7', line: '#e5e5e5', text: '#32363a', label: '#6a6d70',
  blue: colors.primary, blueDark: colors.primaryDark, blueSoft: colors.primarySoft,
  good: '#107e3e', error: '#bb0000', warn: '#e9730c', neutral: '#6a6d70',
};

export function FioriButton({ title, onPress, variant = 'emphasized', disabled }) {
  const [hover, setHover] = useState(false);
  const base = variant === 'emphasized' ? s.emph : variant === 'transparent' ? s.ghost : s.default;
  const hov = variant === 'emphasized' ? s.emphHover : s.ghostHover;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      style={[s.btn, base, hover && !disabled && hov, disabled && { opacity: 0.5 }]}
    >
      <Text style={[s.btnText, variant === 'emphasized' && { color: '#fff' }]}>{title}</Text>
    </Pressable>
  );
}

export function FioriPage({ children }) {
  return <View style={s.page}>{children}</View>;
}

// Header strip: optional count on the left, action buttons on the right.
export function FioriHeader({ count, unit = 'item', actions }) {
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        {count !== undefined && count !== null ? (
          <Text style={s.count}>{count} {unit}{count === 1 ? '' : 's'}</Text>
        ) : null}
      </View>
      <View style={s.actions}>{actions}</View>
    </View>
  );
}

export function FioriPanel({ children, style }) {
  return <View style={[s.panel, style]}>{children}</View>;
}

// Panel toolbar: title + count on the left, custom node (e.g. search) on the right.
export function FioriToolbar({ title, count, right }) {
  return (
    <View style={s.toolbar}>
      <Text style={s.toolbarTitle}>
        {title}{count !== undefined ? <Text style={s.toolbarCount}> ({count})</Text> : null}
      </Text>
      {right}
    </View>
  );
}

export function FioriSearch({ value, onChangeText, placeholder = 'Search' }) {
  return (
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
      placeholderTextColor={FIORI.label} style={s.search} />
  );
}

// ObjectStatus: coloured dot + semantic label. `tone` = good|error|warn|neutral.
export function FioriStatus({ label, tone = 'neutral' }) {
  const c = FIORI[tone] || FIORI.neutral;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ color: c, fontWeight: '600', fontSize: 12.5, textTransform: 'capitalize' }}>{label}</Text>
    </View>
  );
}

// Fiori pagination row (Previous / page / Next + entry count).
export function FioriPager({ from, to, total, page, totalPages, onPage }) {
  return (
    <View style={s.pagination}>
      <Text style={s.entries}>Showing {from} to {to} of {total} entries</Text>
      <View style={s.pager}>
        <Pressable disabled={page <= 1} onPress={() => onPage(page - 1)} style={[s.pageBtn, page <= 1 && s.pageBtnDisabled]}><Text style={s.pageBtnText}>Previous</Text></Pressable>
        <View style={[s.pageBtn, s.pageCurrent]}><Text style={{ color: '#fff', fontWeight: '700' }}>{page}</Text></View>
        <Pressable disabled={page >= totalPages} onPress={() => onPage(page + 1)} style={[s.pageBtn, page >= totalPages && s.pageBtnDisabled]}><Text style={s.pageBtnText}>Next</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: FIORI.line, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  count: { fontSize: 13, color: FIORI.label, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: FIORI.line, borderRadius: 8, padding: 16 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: FIORI.line },
  toolbarTitle: { fontSize: 15, fontWeight: '700', color: FIORI.text },
  toolbarCount: { color: FIORI.label, fontWeight: '600' },
  search: { borderWidth: 1, borderColor: FIORI.line, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, minWidth: 220, color: FIORI.text, backgroundColor: '#fff', outlineStyle: 'none' },

  btn: { borderRadius: 4, paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnText: { fontSize: 13.5, fontWeight: '600', color: FIORI.blue },
  emph: { backgroundColor: FIORI.blue, borderColor: FIORI.blue },
  emphHover: { backgroundColor: FIORI.blueDark, borderColor: FIORI.blueDark },
  default: { backgroundColor: '#fff', borderColor: FIORI.blue },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  ghostHover: { backgroundColor: FIORI.blueSoft },

  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: FIORI.label, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: FIORI.line, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { color: FIORI.blue, fontWeight: '600' },
  pageCurrent: { backgroundColor: FIORI.blue, borderColor: FIORI.blue },
});
