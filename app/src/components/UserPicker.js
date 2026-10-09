// Searchable user picker: type any part of the login id, name, shop or mobile and pick from the matches.
// Replaces typed login ids and the "first 100 users" dropdowns. Web: popover under the field (portal on
// document.body like Select / DateField); native: a modal.
//   mode     'admin' (every user) | 'network' (only my own downline; scope 'direct' = users directly under me)
//   valueKey what onChange receives: 'id' | 'user_code' (the login id text, used by commission slots)
//   userTypeId  only users of this type
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Modal, Platform, StyleSheet } from 'react-native';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { colors, radius, shadows } from '../theme';

const POP_W = 340; const POP_H = 330; const ITEM_H = 54;

export default function UserPicker({
  label, value, onChange, valueKey = 'id', mode = 'admin', scope = 'all', userTypeId = null,
  clearable = true, placeholder = 'Search user…', disabled = false,
}) {
  const web = Platform.OS === 'web' && typeof document !== 'undefined';
  const idMode = valueKey === 'id';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const [selected, setSelected] = useState(null); // the chosen user (for its label)
  const [missing, setMissing] = useState(false); // a saved value that no longer matches any user
  const anchorRef = useRef(null); const listRef = useRef(null);

  const search = (params) => (mode === 'network' ? api.network.users.search({ scope, ...params }) : api.managedUsers.search(params));
  const same = (u, v) => !!u && (idMode ? String(u.id) === String(v) : String(u.user_code).toLowerCase() === String(v).toLowerCase());

  // Turn a saved value (id or login id) back into a readable user.
  useEffect(() => {
    if (!value) { setSelected(null); setMissing(false); return undefined; }
    if (same(selected, value)) return undefined;
    let live = true;
    search(idMode ? { id: value } : { userCode: value })
      .then((r) => { if (live) { setSelected((r.rows || [])[0] || null); setMissing(!(r.rows || []).length); } })
      .catch(() => { if (live) { setSelected(null); setMissing(true); } });
    return () => { live = false; };
    /* eslint-disable-next-line */
  }, [value, valueKey, mode, scope]);

  // Search while the list is open (the first load is immediate, typing is debounced).
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      search({ q: q.trim(), userTypeId: (Array.isArray(userTypeId) ? userTypeId.join(',') : userTypeId) || undefined, limit: 20 })
        .then((r) => { if (live) { setRows(r.rows || []); setActive(0); setErr(null); } })
        .catch((e) => { if (live) { setRows([]); setErr(e.message); } })
        .finally(() => { if (live) setLoading(false); });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
    /* eslint-disable-next-line */
  }, [open, q, String(userTypeId), mode, scope]);

  // Esc closes (web); the popover follows the field on scroll / resize.
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

  // Keep the highlighted row in view while using the arrow keys.
  useEffect(() => { try { listRef.current && listRef.current.scrollTo({ y: Math.max(0, active * ITEM_H - ITEM_H * 2), animated: false }); } catch (e) { /* ignore */ } }, [active]);

  // Under the field when it fits, above when only that fits, otherwise pinned inside the window.
  // Coordinates are divided by the page zoom (the portal is inside the zoomed document), as in Select.
  const measure = () => {
    try {
      const r = anchorRef.current.getBoundingClientRect();
      let z = 1;
      try { z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; } catch (e) { z = 1; }
      const vw = window.innerWidth / z; const vh = window.innerHeight / z;
      const width = Math.max(r.width / z, POP_W);
      const left = Math.max(8, Math.min(r.left / z, vw - width - 8));
      const below = vh - r.bottom / z; const above = r.top / z;
      const maxTop = Math.max(8, vh - POP_H - 8);
      if (below >= POP_H + 12 || below >= above) setPos({ left, width, top: Math.min(r.bottom / z + 4, maxTop) });
      else if (above >= POP_H + 12) setPos({ left, width, bottom: vh - r.top / z + 4 });
      else setPos({ left, width, top: 8 });
    } catch (e) { setPos(null); }
  };

  const openList = () => { if (disabled) return; setQ(''); setRows([]); if (web) measure(); setOpen(true); };
  const close = () => setOpen(false);
  const pick = (u) => { if (!u) return; setSelected(u); setMissing(false); onChange(idMode ? u.id : u.user_code, u); close(); };
  const clear = () => { setSelected(null); setMissing(false); onChange('', null); };

  const onKeyPress = (e) => {
    const k = e && e.nativeEvent ? e.nativeEvent.key : '';
    if (k === 'ArrowDown') setActive((i) => Math.min(Math.max(rows.length - 1, 0), i + 1));
    else if (k === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (k === 'Enter') pick(rows[active]);
  };

  const panel = (
    <>
      <TextInput value={q} onChangeText={setQ} onKeyPress={onKeyPress} autoFocus placeholder="Type login id, name, shop or mobile…"
        placeholderTextColor={colors.muted} style={styles.search} autoCapitalize="none" />
      <ScrollView ref={listRef} style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {loading && !rows.length ? <View style={styles.note}><ActivityIndicator color={colors.primary} /></View> : null}
        {err ? <Text style={[styles.note, { color: colors.danger }]}>{err}</Text> : null}
        {!loading && !err && !rows.length ? <Text style={styles.note}>{q ? 'No users found.' : 'No users to choose from.'}</Text> : null}
        {rows.map((u, i) => (
          <Pressable key={u.id} onPress={() => pick(u)} onHoverIn={() => setActive(i)} style={[styles.item, i === active && styles.itemOn]}>
            <View style={styles.itemTop}>
              <Text style={styles.itemCode}>{u.user_code}</Text>
              <Text style={styles.itemName} numberOfLines={1}>{u.name}</Text>
              {!u.is_active ? <Text style={styles.tag}>Inactive</Text> : null}
            </View>
            <Text style={styles.itemSub} numberOfLines={1}>{[u.user_type_name, u.mobile, u.shop_name].filter(Boolean).join(' · ')}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );

  const popover = (
    <>
      <Pressable style={styles.catcher} onPress={close} />
      <View style={[styles.pop, pos || { left: 20, top: 100, width: POP_W }]}>{panel}</View>
    </>
  );

  const shown = selected
    ? `${selected.user_code} · ${selected.name}${selected.is_active ? '' : ' (inactive)'}`
    : (value && missing ? `${value}  (user not found)` : '');

  return (
    <View style={{ gap: 6, zIndex: open ? 9999 : 1, position: 'relative' }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View ref={anchorRef} style={{ position: 'relative' }}>
        <Pressable style={[styles.box, open && styles.boxOpen, disabled && { opacity: 0.55 }]} onPress={() => (open ? close() : openList())} disabled={disabled}>
          <Text style={{ color: shown ? (missing ? colors.danger : colors.text) : colors.muted, flex: 1 }} numberOfLines={1}>{shown || placeholder}</Text>
          {clearable && value && !disabled ? <Pressable onPress={clear} hitSlop={8}><Text style={styles.x}>✕</Text></Pressable> : null}
          <Text style={{ color: colors.muted, marginLeft: 8 }}>🔍</Text>
        </Pressable>
        {open && web ? createPortal(popover, document.body) : null}
      </View>

      {!web ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
          <Pressable style={styles.backdrop} onPress={close}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation?.()}>{panel}</Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  box: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, minHeight: 38 },
  boxOpen: { borderColor: colors.primary },
  x: { color: colors.muted, fontSize: 14, paddingHorizontal: 6 },
  catcher: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 },
  pop: { position: 'fixed', zIndex: 9999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, ...shadows.pop },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, width: '100%', maxWidth: 420 },
  search: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.text, marginBottom: 6, outlineStyle: 'none' },
  note: { color: colors.muted, padding: 14, textAlign: 'center' },
  item: { height: ITEM_H, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 8 },
  itemOn: { backgroundColor: '#eff6ff' },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemCode: { fontWeight: '800', color: colors.primary, fontSize: 13.5 },
  itemName: { flex: 1, fontWeight: '600', color: colors.text, fontSize: 13.5 },
  itemSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  tag: { fontSize: 10.5, fontWeight: '800', color: colors.danger, backgroundColor: colors.dangerBg || '#fee2e2', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
});
