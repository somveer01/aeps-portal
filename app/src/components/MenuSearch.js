import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import Icon from './Icon';
import { colors, radius, shadows } from '../theme';

// Flatten the menu tree to clickable screens, remembering the parent path.
function flatten(nodes, trail = [], ids = [], out = []) {
  (nodes || []).forEach((n) => {
    if (n.children && n.children.length) {
      flatten(n.children, [...trail, n.title], [...ids, n.id], out);
    } else if (n.route && n.route !== '/logout') {
      out.push({ node: n, path: trail.join(' › '), ancestorIds: ids, hay: `${n.title} ${trail.join(' ')}`.toLowerCase() });
    }
  });
  return out;
}

function search(items, q) {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return items
    .filter((it) => tokens.every((t) => it.hay.includes(t)))
    .map((it) => {
      const title = it.node.title.toLowerCase();
      const rank = title.startsWith(tokens[0]) ? 0 : title.includes(tokens[0]) ? 1 : 2;
      return { it, rank };
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map((r) => r.it);
}

// variant: 'topbar' (translucent, on the coloured bar) | 'sidebar' (light field).
export default function MenuSearch({ menu, onSelect, variant = 'sidebar', style }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const closeTimer = useRef(null);
  const topbar = variant === 'topbar';

  const items = useMemo(() => flatten(menu), [menu]);
  const results = useMemo(() => search(items, q), [items, q]);
  const showList = open && q.trim().length > 0;

  const pick = (it) => {
    setQ(''); setOpen(false); setHi(0);
    onSelect(it.node, it.ancestorIds);
  };

  const onKeyPress = (e) => {
    const k = e.nativeEvent.key;
    if (k === 'ArrowDown') { e.preventDefault?.(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    else if (k === 'ArrowUp') { e.preventDefault?.(); setHi((h) => Math.max(h - 1, 0)); }
    else if (k === 'Enter' && results[hi]) pick(results[hi]);
    else if (k === 'Escape') { setQ(''); setOpen(false); }
  };

  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.field, topbar ? styles.fieldTop : styles.fieldSide]}>
        <Icon name="search" size={16} color={topbar ? '#fff' : colors.muted} />
        <TextInput
          value={q}
          onChangeText={(v) => { setQ(v); setOpen(true); setHi(0); }}
          onFocus={() => { clearTimeout(closeTimer.current); setOpen(true); }}
          onBlur={() => { closeTimer.current = setTimeout(() => setOpen(false), 150); }}
          onKeyPress={onKeyPress}
          placeholder="Search menu…"
          placeholderTextColor={topbar ? 'rgba(255,255,255,0.75)' : colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: topbar ? '#fff' : colors.text }]}
        />
        {q ? (
          <Pressable onPress={() => { setQ(''); setOpen(false); }} hitSlop={8}>
            <Text style={{ color: topbar ? '#fff' : colors.muted, fontSize: 14 }}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {showList ? (
        <View style={styles.list}>
          {results.length === 0 ? (
            <Text style={styles.empty}>No screens match “{q.trim()}”</Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }}>
              {results.map((it, i) => (
                <Pressable key={it.node.id} onPress={() => pick(it)} onHoverIn={() => setHi(i)}
                  style={[styles.row, i === hi && styles.rowOn]}>
                  <Icon name={it.node.icon} size={16} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{it.node.title}</Text>
                    {it.path ? <Text style={styles.rowPath} numberOfLines={1}>{it.path}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 50 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 38, borderWidth: 1 },
  fieldTop: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.22)', borderRadius: 22 },
  fieldSide: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.md },
  input: { flex: 1, minWidth: 0, fontSize: 14, outlineStyle: 'none', paddingVertical: 0 },
  list: { position: 'absolute', top: 44, left: 0, right: 0, minWidth: 260, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadows.pop },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  rowOn: { backgroundColor: colors.primarySoft },
  rowTitle: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  rowPath: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  empty: { color: colors.muted, padding: 14, fontSize: 13 },
});
