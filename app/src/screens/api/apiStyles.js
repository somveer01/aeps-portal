// Shared look of the API Management screens (API Configuration, SP Keys, Product Switch, Customer Switch).
// Same tokens as the other master screens, so Classic / Modern and the saved theme colours apply.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking, Platform, ActivityIndicator } from 'react-native';
import { colors, radius } from '../../theme';

export const COMMISSION_TYPES = [
  { value: 'percent', label: '% (they pay us)' },
  { value: 'flat', label: 'FLAT ₹ (they pay us)' },
  { value: 'surcharge', label: 'Surcharge ₹ (we pay them)' },
  { value: 'surcharge_percent', label: 'Surcharge % (we pay them)' },
];
export const typeShort = (t) => ({ percent: '%', flat: 'FLAT', surcharge: 'Surcharge', surcharge_percent: 'Surcharge %' }[t] || t);

// Previous / page / Next row under a list.
export function Pager({ page, total, pageSize, onPage }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1; const to = Math.min(total, page * pageSize);
  return (
    <View style={s.pagination}>
      <Text style={s.entries}>Showing {from} to {to} of {total} entries</Text>
      <View style={s.pager}>
        <Pressable disabled={page <= 1} onPress={() => onPage(page - 1)} style={[s.pageBtn, page <= 1 && s.pageBtnDisabled]}><Text style={s.pageBtnText}>Previous</Text></Pressable>
        <View style={[s.pageBtn, s.pageCurrent]}><Text style={{ color: colors.onPrimary, fontWeight: '700' }}>{page}</Text></View>
        <Pressable disabled={page >= totalPages} onPress={() => onPage(page + 1)} style={[s.pageBtn, page >= totalPages && s.pageBtnDisabled]}><Text style={s.pageBtnText}>Next</Text></Pressable>
      </View>
    </View>
  );
}

// Small coloured label (Active / Off / Mock / Default ...).
export function Chip({ text, tone = 'muted' }) {
  const t = {
    success: { bg: '#dcfce7', fg: '#166534' }, danger: { bg: '#fee2e2', fg: '#991b1b' }, warning: { bg: '#fef3c7', fg: '#92400e' },
    primary: { bg: colors.primarySoft, fg: colors.primary }, muted: { bg: '#f1f5f9', fg: '#475569' },
  }[tone] || { bg: '#f1f5f9', fg: '#475569' };
  return <View style={[s.chip, { backgroundColor: t.bg }]}><Text style={[s.chipText, { color: t.fg }]} numberOfLines={1}>{text}</Text></View>;
}

// Cards instead of a grid (Product Switch, Customer Switch): a wrapping row of equal-ish cards. The grid is a row, so the
// cards may use a flexBasis; on a phone each card takes the full width. `changed` = unsaved edit (amber), `off` = dimmed.
export function CardGrid({ children, loading, empty }) {
  if (loading) return <View style={s.cardsEmpty}><ActivityIndicator color={colors.primary} /></View>;
  const items = React.Children.toArray(children);
  if (!items.length) return <View style={s.cardsEmpty}><Text style={{ color: colors.muted }}>{empty || 'Nothing to show.'}</Text></View>;
  return <View style={s.cardsWrap}>{items}</View>;
}
export function ItemCard({ children, changed, off, onPress }) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[s.itemCard, changed && s.itemCardChanged, off && { opacity: 0.65 }]}>{children}</Wrap>
  );
}

// An http(s) address shown as a link that opens in a new tab (web) / the browser app (native). Never carries the
// username or password: the partner's own page asks for them.
export const isWebUrl = (v) => /^https?:\/\/[^\s]+$/i.test(String(v || '').trim());
export function ExternalLink({ url, children, style, numberOfLines = 1 }) {
  const u = String(url || '').trim();
  if (!isWebUrl(u)) return <Text style={style || s.td} numberOfLines={numberOfLines}>{children || u || '—'}</Text>;
  const web = Platform.OS === 'web';
  return (
    <Text
      accessibilityRole="link" numberOfLines={numberOfLines} style={[style || s.td, s.link]}
      {...(web ? { href: u, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } : { onPress: () => Linking.openURL(u) })}
    >
      {children || u}
    </Text>
  );
}

export const s = StyleSheet.create({
  link: { color: colors.primary, textDecorationLine: 'underline', fontWeight: '600' },
  cardsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cardsEmpty: { padding: 30, alignItems: 'center' },
  itemCard: { flexGrow: 1, flexBasis: 300, minWidth: 240, maxWidth: 460, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 12 },
  itemCardChanged: { backgroundColor: '#fffbeb', borderColor: '#f59e0b' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardName: { color: colors.text, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  cardLabel: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.primarySoft, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  statNum: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statLbl: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  actionBar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14 },
  field: { flexGrow: 1, flexBasis: '46%', minWidth: 220, gap: 6 },
  fieldWide: { flexGrow: 1, flexBasis: '100%', gap: 6 },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  searchLabel: { color: colors.muted },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, minWidth: 180, color: colors.text, outlineStyle: 'none', backgroundColor: '#fff' },
  input: { minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  inputSm: { minHeight: 40, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.text, outlineStyle: 'none' },
  textarea: { minHeight: 84, textAlignVertical: 'top' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  help: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  td: { color: colors.text, fontSize: 14 },
  tdMuted: { color: colors.muted, fontSize: 12.5 },
  mono: { fontFamily: 'monospace', color: colors.text, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 10 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, maxWidth: '100%' },
  chipText: { fontSize: 11.5, fontWeight: '700' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 }, pageBtnText: { color: colors.text }, pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  info: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: 12, borderLeftWidth: 3, borderLeftColor: colors.primary },
  infoText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  saveRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 },
  dirty: { color: colors.warning, fontWeight: '700', fontSize: 13 },
});
