// Small cross-platform UI kit: Button, TextField, Select, Alert, Card, Logo.
import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, Modal, ScrollView,
} from 'react-native';
import { colors, radius, shadows } from '../theme';

/**
 * Cross-platform searchable dropdown. options: [{ label, value }].
 * Works on web + native (opens a modal list). Reusable on any screen.
 */
export function Select({ label, value, options = [], onChange, placeholder = 'Select…', searchable = true }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = options.find((o) => String(o.value) === String(value));
  const filtered = useMemo(() => {
    if (!q) return options;
    const s = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(s));
  }, [q, options]);

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable style={styles.selectBox} onPress={() => { setQ(''); setOpen(true); }}>
        <Text style={{ color: selected ? colors.text : colors.muted, flex: 1 }} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={{ color: colors.muted }}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.selectBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.selectSheet} onPress={(e) => e.stopPropagation?.()}>
            {label ? <Text style={[styles.label, { marginBottom: 8 }]}>{label}</Text> : null}
            {searchable ? (
              <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.muted} style={[styles.input, { marginBottom: 8 }]} autoFocus />
            ) : null}
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <Text style={{ color: colors.muted, padding: 12 }}>No matches</Text>
              ) : filtered.map((o) => {
                const active = String(o.value) === String(value);
                return (
                  <Pressable key={String(o.value)} onPress={() => { onChange(o.value); setOpen(false); }}
                    style={[styles.option, active && { backgroundColor: '#eff6ff' }]}>
                    <Text style={{ color: active ? colors.primary : colors.text, fontWeight: active ? '700' : '400' }}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Button({ title, onPress, loading, disabled, variant = 'primary', style }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const isGhost = variant === 'ghost';
  const isNavy = variant === 'navy';
  const base = isNavy ? colors.navy : colors.primary;
  const dark = isNavy ? colors.navyDark : colors.primaryDark;
  const bg = isGhost
    ? (pressed || hover ? '#f1f5f9' : 'transparent')
    : (pressed || hover ? dark : base);
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.6 : 1 },
        isGhost && styles.btnGhost,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isGhost ? colors.text : '#fff'} />
      ) : (
        <Text style={[styles.btnText, isGhost && { color: colors.text }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextField({ label, value, onChangeText, secureTextEntry, placeholder, keyboardType, autoFocus, maxLength, style, onSubmitEditing }) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry ? hidden : false}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          maxLength={maxLength}
          autoCapitalize="none"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          style={[styles.input, focused && styles.inputFocused, secureTextEntry && { paddingRight: 44 }]}
        />
        {secureTextEntry ? (
          <Pressable onPress={() => setHidden((h) => !h)} style={styles.eye} hitSlop={8}>
            <Text style={{ fontSize: 16 }}>{hidden ? '👁' : '🙈'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// Cross-platform date picker (custom calendar popover). value/onChange use 'YYYY-MM-DD'.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

export function DateField({ label, value, onChange, placeholder = 'Select date' }) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const [view, setView] = useState(() => (selected || new Date()));
  const y = view.getFullYear(); const m = view.getMonth();
  const firstWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  const todayISO = toISO(new Date());
  const shiftMonth = (delta) => setView(new Date(y, m + delta, 1));
  const pick = (d) => { onChange(toISO(new Date(y, m, d))); setOpen(false); };

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable style={styles.selectBox} onPress={() => { setView(selected || new Date()); setOpen(true); }}>
        <Text style={{ color: value ? colors.text : colors.muted, flex: 1 }}>{value || placeholder}</Text>
        <Text style={{ color: colors.muted }}>📅</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.selectBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.calendar} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.calHeader}>
              <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={styles.calNav}><Text style={styles.calNavText}>‹</Text></Pressable>
              <Text style={styles.calTitle}>{MONTHS[m]} {y}</Text>
              <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={styles.calNav}><Text style={styles.calNavText}>›</Text></Pressable>
            </View>
            <View style={styles.calRow}>
              {WEEKDAYS.map((w) => <Text key={w} style={styles.calWeekday}>{w}</Text>)}
            </View>
            <View style={styles.calGrid}>
              {cells.map((d, i) => {
                if (d === null) return <View key={`e${i}`} style={styles.calCell} />;
                const iso = toISO(new Date(y, m, d));
                const isSel = iso === value; const isToday = iso === todayISO;
                return (
                  <Pressable key={iso} style={[styles.calCell, styles.calDay, isSel && styles.calDaySel, !isSel && isToday && styles.calDayToday]} onPress={() => pick(d)}>
                    <Text style={[styles.calDayText, isSel && { color: '#fff', fontWeight: '700' }]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.calFooter}>
              <Pressable onPress={() => { onChange(''); setOpen(false); }}><Text style={styles.calClear}>Clear</Text></Pressable>
              <Pressable onPress={() => { onChange(todayISO); setOpen(false); }}><Text style={styles.calToday}>Today</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Alert({ type = 'error', children }) {
  if (!children) return null;
  const palette = {
    error: { bg: colors.dangerBg, border: '#fecaca', fg: colors.danger, icon: '⚠' },
    success: { bg: colors.successBg, border: '#a7f3d0', fg: colors.success, icon: '✓' },
    info: { bg: colors.infoBg, border: '#bfdbfe', fg: colors.info, icon: 'ℹ' },
  };
  const p = palette[type] || palette.info;
  return (
    <View style={[styles.alert, { backgroundColor: p.bg, borderColor: p.border }]}>
      <Text style={[styles.alertIcon, { color: p.fg }]}>{p.icon}</Text>
      <Text style={{ color: p.fg, fontSize: 13, flex: 1, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// Rounded status pill — replaces plain colored text across master-screen
// grids (Payout Banks, Fund Requests, Support Tickets, ...). tone selects the
// tint from the theme's semantic pairs (success/danger/warning/info/muted).
const BADGE_TONES = {
  success: { fg: colors.success, bg: colors.successBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  info: { fg: colors.info, bg: colors.infoBg },
  muted: { fg: colors.muted, bg: '#f1f5f9' },
};
export function StatusBadge({ label, tone = 'muted' }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.muted;
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: t.fg }]} />
      <Text style={[styles.badgeText, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Logo({ size = 46 }) {
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size * 0.26 }]}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.48 }}>A</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minHeight: 48, ...shadows.sm },
  btnGhost: { borderWidth: 1, borderColor: colors.border, shadowOpacity: 0, elevation: 0, boxShadow: 'none' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', letterSpacing: 0.1 },
  input: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  inputFocused: { borderColor: colors.primary, backgroundColor: '#fff', boxShadow: `0 0 0 3px ${colors.ring}` },
  eye: { position: 'absolute', right: 8, top: 0, bottom: 0, width: 32, alignItems: 'center', justifyContent: 'center' },
  selectBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, minHeight: 46 },
  selectBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  selectSheet: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, width: '100%', maxWidth: 420, ...shadows.pop },
  option: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.sm },
  calendar: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, width: 300, ...shadows.pop },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  calNav: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  calNavText: { fontSize: 20, color: colors.text, lineHeight: 22 },
  calRow: { flexDirection: 'row' },
  calWeekday: { width: `${100 / 7}%`, textAlign: 'center', color: colors.muted, fontSize: 12, fontWeight: '600', paddingVertical: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calDay: { borderRadius: 8 },
  calDaySel: { backgroundColor: colors.primary },
  calDayToday: { borderWidth: 1, borderColor: colors.primary },
  calDayText: { color: colors.text, fontSize: 13.5 },
  calFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  calClear: { color: colors.muted, fontWeight: '600' },
  calToday: { color: colors.primary, fontWeight: '700' },
  alert: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 11, paddingHorizontal: 13, borderRadius: radius.md, borderWidth: 1 },
  alertIcon: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 22, ...shadows.card },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  logo: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.sm },
});
