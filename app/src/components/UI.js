// Small cross-platform UI kit: Button, TextField, Select, Alert, Card, Logo.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, Modal, ScrollView, Platform,
} from 'react-native';
import { createPortal } from 'react-dom';
import { colors, radius, shadows } from '../theme';
import buttonLabel from './buttonLabel';

/**
 * Cross-platform searchable dropdown. options: [{ label, value }].
 * Works on web + native (opens a modal list). Reusable on any screen.
 */
export function Select({ label, value, options = [], onChange, placeholder = 'Select…', searchable = true }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [box, setBox] = useState(null); // measured anchor rect (web overlay)
  const anchorRef = useRef(null);
  const web = Platform.OS === 'web';
  const selected = options.find((o) => String(o.value) === String(value));
  const filtered = useMemo(() => {
    if (!q) return options;
    const s = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(s));
  }, [q, options]);

  // Measure the field so the list can render in a body portal (escapes every
  // parent stacking context / overflow). Coords are divided by the page zoom
  // because the portal is inside the zoomed document and gets re-scaled.
  const measure = () => {
    try {
      const r = anchorRef.current.getBoundingClientRect();
      let z = 1;
      try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e) { z = 1; }
      setBox({ left: r.left / z, top: r.bottom / z, width: r.width / z });
    } catch (e) { setBox(null); }
  };
  const toggle = () => { setQ(''); if (!open && web) measure(); setOpen((o) => !o); };

  const list = (
    <View style={[styles.dropdown, web && box ? { position: 'fixed', left: box.left, top: box.top + 4, width: box.width } : null]}>
      {/* search is available in every dropdown */}
      <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.muted}
        style={styles.dropSearch} autoFocus />
      <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
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
    </View>
  );

  const overlay = (
    <>
      {/* click-away catcher (full viewport, behind the list) */}
      <Pressable style={styles.dropCatcher} onPress={() => setOpen(false)} />
      {list}
    </>
  );

  return (
    <View style={{ gap: 6, zIndex: open ? 9999 : 1, position: 'relative' }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View ref={anchorRef} style={{ position: 'relative' }}>
        <Pressable style={[styles.selectBox, open && styles.selectBoxOpen]} onPress={toggle}>
          <Text style={{ color: selected ? colors.text : colors.muted, flex: 1 }} numberOfLines={1}>
            {selected ? selected.label : placeholder}
          </Text>
          <Text style={{ color: colors.muted, transform: [{ rotate: open ? '180deg' : '0deg' }] }}>▾</Text>
        </Pressable>

        {open ? (web && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay) : null}
      </View>
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
  const onBtn = isNavy ? '#fff' : colors.onPrimary; // readable on a light primary too
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
        <ActivityIndicator color={isGhost ? colors.text : onBtn} />
      ) : (
        <Text style={[styles.btnText, { color: onBtn }, isGhost && { color: colors.text }]}>{buttonLabel(title)}</Text>
      )}
    </Pressable>
  );
}

export function TextField({ label, value, onChangeText, secureTextEntry, placeholder, keyboardType, autoFocus, maxLength, style, onSubmitEditing, editable = true }) {
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
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          style={[styles.input, focused && styles.inputFocused, secureTextEntry && { paddingRight: 44 }, !editable && { backgroundColor: '#f1f5f9', color: colors.muted }]}
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

// Cross-platform date picker. value/onChange use 'YYYY-MM-DD'.
// Web: a popover right under the field (portal on document.body, like Select; flips above when there is no room).
// Native: a centred modal. The header has a Month and a Year chooser besides the arrows.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const CAL_W = 300; const CAL_H = 350; const YEAR_ROW = 40; const PANEL_H = 232;

export function DateField({ label, value, onChange, placeholder = 'Select date', minYear, maxYear }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('days'); // 'days' | 'months' | 'years'
  const [pos, setPos] = useState(null); // web popover position
  const anchorRef = useRef(null);
  const yearsRef = useRef(null);
  const web = Platform.OS === 'web' && typeof document !== 'undefined';
  const selected = parseISO(value);
  const [view, setView] = useState(() => (selected || new Date()));
  const y = view.getFullYear(); const m = view.getMonth();
  const nowY = new Date().getFullYear();
  const lo = Math.min(minYear != null ? minYear : nowY - 100, y); const hi = Math.max(maxYear != null ? maxYear : nowY + 10, y);
  const years = []; for (let yr = lo; yr <= hi; yr += 1) years.push(yr);
  const firstWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  const todayISO = toISO(new Date());
  const close = () => setOpen(false);
  const shiftMonth = (delta) => setView(new Date(y, m + delta, 1));
  const pick = (d) => { onChange(toISO(new Date(y, m, d))); close(); };

  // Place the popover under the field (above it when there is no room). Coordinates are divided by the
  // page zoom because the portal sits inside the zoomed document and is scaled again (see Select).
  const measure = () => {
    try {
      const r = anchorRef.current.getBoundingClientRect();
      let z = 1;
      try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e) { z = 1; }
      const vw = window.innerWidth / z; const vh = window.innerHeight / z;
      const left = Math.max(8, Math.min(r.left / z, vw - CAL_W - 8));
      const below = vh - r.bottom / z; const above = r.top / z;
      const maxTop = Math.max(8, vh - CAL_H - 8);
      // Under the field when it fits (or there is more room below); above it when only that fits;
      // otherwise pinned inside the window so the whole calendar stays visible.
      if (below >= CAL_H + 12 || below >= above) setPos({ left, top: Math.min(r.bottom / z + 4, maxTop) });
      else if (above >= CAL_H + 12) setPos({ left, bottom: vh - r.top / z + 4 });
      else setPos({ left, top: 8 });
    } catch (e) { setPos(null); }
  };
  const openCal = () => { setView(selected || new Date()); setMode('days'); if (web) measure(); setOpen(true); };

  // Web: Esc closes; the popover follows the field on scroll / resize.
  useEffect(() => {
    if (!open || !web) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => measure();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
    /* eslint-disable-next-line */
  }, [open, web]);

  // Year chooser opens scrolled to the year being viewed.
  useEffect(() => {
    if (!open || mode !== 'years') return undefined;
    const t = setTimeout(() => { try { yearsRef.current && yearsRef.current.scrollTo({ y: Math.max(0, (Math.floor((y - lo) / 4) - 2) * YEAR_ROW), animated: false }); } catch (e) { /* ignore */ } }, 0);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [open, mode]);

  const arrow = (delta) => () => { if (mode === 'days') shiftMonth(delta); else if (mode === 'months') setView(new Date(y + delta, m, 1)); };
  const arrowsOff = mode === 'years';

  const panel = (
    <>
      <View style={styles.calHeader}>
        <Pressable onPress={arrow(-1)} disabled={arrowsOff} hitSlop={8} style={[styles.calNav, arrowsOff && { opacity: 0.3 }]}><Text style={styles.calNavText}>‹</Text></Pressable>
        <View style={styles.calChips}>
          <Pressable onPress={() => setMode(mode === 'months' ? 'days' : 'months')} style={[styles.calChip, mode === 'months' && styles.calChipOn]}>
            <Text style={styles.calChipText}>{MONTHS[m]} ▾</Text>
          </Pressable>
          <Pressable onPress={() => setMode(mode === 'years' ? 'days' : 'years')} style={[styles.calChip, mode === 'years' && styles.calChipOn]}>
            <Text style={styles.calChipText}>{y} ▾</Text>
          </Pressable>
        </View>
        <Pressable onPress={arrow(1)} disabled={arrowsOff} hitSlop={8} style={[styles.calNav, arrowsOff && { opacity: 0.3 }]}><Text style={styles.calNavText}>›</Text></Pressable>
      </View>

      {mode === 'days' ? (
        <>
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
        </>
      ) : null}

      {mode === 'months' ? (
        <View style={styles.calMonthGrid}>
          {MONTHS.map((name, i) => {
            const isSel = !!selected && selected.getFullYear() === y && selected.getMonth() === i;
            const isNow = new Date().getFullYear() === y && new Date().getMonth() === i;
            return (
              <Pressable key={name} style={[styles.calMonthCell, isSel && styles.calDaySel, !isSel && isNow && styles.calDayToday]} onPress={() => { setView(new Date(y, i, 1)); setMode('days'); }}>
                <Text style={[styles.calDayText, isSel && { color: '#fff', fontWeight: '700' }]}>{name.slice(0, 3)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {mode === 'years' ? (
        <ScrollView ref={yearsRef} style={{ height: PANEL_H }} nestedScrollEnabled showsVerticalScrollIndicator>
          <View style={styles.calYearGrid}>
            {years.map((yr) => {
              const isSel = !!selected && selected.getFullYear() === yr; const isNow = yr === nowY; const isView = yr === y;
              return (
                <Pressable key={yr} style={[styles.calYearCell, isView && !isSel && styles.calChipOn, isSel && styles.calDaySel, !isSel && isNow && styles.calDayToday]} onPress={() => { setView(new Date(yr, m, 1)); setMode('days'); }}>
                  <Text style={[styles.calDayText, isSel && { color: '#fff', fontWeight: '700' }]}>{yr}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : null}

      <View style={styles.calFooter}>
        <Pressable onPress={() => { onChange(''); close(); }}><Text style={styles.calClear}>Clear</Text></Pressable>
        <Pressable onPress={() => { onChange(todayISO); close(); }}><Text style={styles.calToday}>Today</Text></Pressable>
      </View>
    </>
  );

  const popover = (
    <>
      {/* click-away catcher (full viewport, behind the calendar) */}
      <Pressable style={styles.dropCatcher} onPress={close} />
      <View style={[styles.calendar, styles.calPopover, pos || { left: 20, top: 100 }]}>{panel}</View>
    </>
  );

  return (
    <View style={{ gap: 6, zIndex: open ? 9999 : 1, position: 'relative' }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View ref={anchorRef} style={{ position: 'relative' }}>
        <Pressable style={[styles.selectBox, open && styles.selectBoxOpen]} onPress={() => (open ? close() : openCal())}>
          <Text style={{ color: value ? colors.text : colors.muted, flex: 1 }}>{value || placeholder}</Text>
          <Text style={{ color: colors.muted }}>📅</Text>
        </Pressable>
        {open && web ? createPortal(popover, document.body) : null}
      </View>

      {!web ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
          <Pressable style={styles.selectBackdrop} onPress={close}>
            <Pressable style={styles.calendar} onPress={(e) => e.stopPropagation?.()}>{panel}</Pressable>
          </Pressable>
        </Modal>
      ) : null}
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
  selectBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, minHeight: 38 },
  selectBoxOpen: { borderColor: colors.primary },
  selectBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  selectSheet: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, width: '100%', maxWidth: 420, ...shadows.pop },
  // Inline dropdown (opens below the field, not a modal)
  dropCatcher: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 4, zIndex: 9999, elevation: 24, ...shadows.pop },
  dropSearch: { backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.text, outlineStyle: 'none', margin: 4, borderRadius: radius.sm },
  option: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm, marginHorizontal: 4 },
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
  calPopover: { position: 'fixed', zIndex: 9999, borderWidth: 1, borderColor: colors.border },
  calChips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: '#f1f5f9' },
  calChipOn: { backgroundColor: '#dbeafe' },
  calChipText: { fontSize: 14, fontWeight: '700', color: colors.text },
  calMonthGrid: { flexDirection: 'row', flexWrap: 'wrap', minHeight: PANEL_H },
  calMonthCell: { width: '33.333%', height: PANEL_H / 4, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  calYearGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calYearCell: { width: '25%', height: YEAR_ROW, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  alert: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 11, paddingHorizontal: 13, borderRadius: radius.md, borderWidth: 1 },
  alertIcon: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 22, ...shadows.card },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  logo: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.sm },
});
