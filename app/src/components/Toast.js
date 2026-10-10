import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Platform } from 'react-native';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { shadows } from '../theme';

// App-wide confirmation messages ("Saved successfully", "Recharge successful", an error with its reason ...).
// Anything can call  toast.success('...') / toast.error('...') / toast.warning('...') / toast.info('...').
// The API client calls it automatically after every save / create / update / delete / transaction (see api/feedback.js),
// so screens do not have to. <ToastHost /> is mounted once in App.js.
const listeners = new Set();
let seq = 0;
const recent = new Map(); // "type|text" -> time, so the same message is not stacked twice within a moment

function push(type, text, opts = {}) {
  if (!text) return null;
  const key = `${type}|${text}`;
  const now = Date.now();
  if (recent.has(key) && now - recent.get(key) < 1200) return null;
  recent.set(key, now);
  const t = { id: ++seq, type, text: String(text), title: opts.title || null, ms: opts.ms || DURATION[type] };
  listeners.forEach((fn) => fn({ add: t }));
  return t.id;
}
const DURATION = { success: 4000, info: 4500, warning: 6500, error: 7000 };

export const toast = {
  success: (text, opts) => push('success', text, opts),
  error: (text, opts) => push('error', text, opts),
  warning: (text, opts) => push('warning', text, opts),
  info: (text, opts) => push('info', text, opts),
  dismiss: (id) => listeners.forEach((fn) => fn({ remove: id })),
  // Show a message AFTER the page reloads (web only): used when a save reloads the app to apply the new look.
  flash: (type, text) => { try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(FLASH_KEY, JSON.stringify({ type, text })); } catch (e) { /* ignore */ } },
};
const FLASH_KEY = 'aeps.flashToast';

const TONE = {
  success: { color: '#16a34a', bg: '#f0fdf4', icon: 'check', title: 'Success' },
  error: { color: '#dc2626', bg: '#fef2f2', icon: 'xcircle', title: 'Could not complete' },
  warning: { color: '#d97706', bg: '#fffbeb', icon: 'clock', title: 'Please note' },
  info: { color: '#2563eb', bg: '#eff6ff', icon: 'check', title: 'Information' },
};

function Item({ t, onClose }) {
  const tone = TONE[t.type] || TONE.info;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    const timer = setTimeout(onClose, t.ms);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }}>
      <Pressable onPress={onClose} accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.item, { borderLeftColor: tone.color, backgroundColor: '#fff' }]}>
        <View style={[styles.iconDisc, { backgroundColor: tone.bg }]}><Icon name={tone.icon} size={18} color={tone.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: tone.color }]}>{t.title || tone.title}</Text>
          <Text style={styles.text}>{t.text}</Text>
        </View>
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </Animated.View>
  );
}

export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (e) => {
      if (e.add) setItems((list) => [...list, e.add].slice(-4)); // at most 4 on screen
      if (e.remove) setItems((list) => list.filter((x) => x.id !== e.remove));
    };
    listeners.add(fn);
    // a message left by toast.flash() before a reload
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(FLASH_KEY);
        if (raw) { sessionStorage.removeItem(FLASH_KEY); const f = JSON.parse(raw); push(f.type || 'success', f.text); }
      }
    } catch (e) { /* ignore */ }
    return () => { listeners.delete(fn); };
  }, []);
  if (!items.length) return null;
  const stack = (
    <View pointerEvents="box-none" style={styles.stack}>
      {items.map((t) => <Item key={t.id} t={t} onClose={() => setItems((list) => list.filter((x) => x.id !== t.id))} />)}
    </View>
  );
  // On the web the stack is portaled to <body> so it also sits above open modals (receipts, dropdowns, calendars).
  if (Platform.OS === 'web' && typeof document !== 'undefined') return createPortal(stack, document.body);
  return stack;
}

const styles = StyleSheet.create({
  stack: Platform.select({
    web: { position: 'fixed', top: 76, right: 16, zIndex: 100000, width: 380, maxWidth: '92%', gap: 10 },
    default: { position: 'absolute', top: 48, left: 12, right: 12, zIndex: 100000, gap: 10 },
  }),
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 12, borderLeftWidth: 5, borderWidth: 1, borderColor: '#e5e7eb', ...shadows.pop },
  iconDisc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13.5, fontWeight: '800' },
  text: { color: '#334155', fontSize: 13.5, marginTop: 2, lineHeight: 19 },
  close: { color: '#94a3b8', fontSize: 14, paddingLeft: 4 },
});
