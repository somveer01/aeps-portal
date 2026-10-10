import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Icon from './Icon';
import BrandLogo from './BrandLogo';
import MenuSearch from './MenuSearch';
import { colors, shadows } from '../theme';

// Sidebar of the "Modern" layout: wide, every top-level menu item has its own coloured icon tile (colours are picked
// automatically by position, children use their parent's colour), the active item is tinted with a glow ring around its
// tile, and the whole bar can collapse to just the tiles.
export const MODERN_HEADER_HEIGHT = 64;
export const MODERN_SIDEBAR_W = 264;
export const MODERN_SIDEBAR_COLLAPSED_W = 78;

const TONES = ['#7c3aed', '#2563eb', '#4f46e5', '#16a34a', '#d97706', '#db2777', '#dc2626', '#0d9488', '#475569', '#ea580c'];
export const toneFor = (index) => TONES[index % TONES.length];
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const hasActive = (node, route) => node.route === route || (node.children || []).some((c) => hasActive(c, route));

function Child({ node, active, tone, onSelect, depth = 0 }) {
  const isActive = active.route && active.route === node.route;
  const kids = node.children || [];
  return (
    <View>
      <Pressable
        onPress={() => (kids.length ? null : onSelect(node))}
        style={({ hovered }) => [styles.child, { marginLeft: 10 + depth * 14 }, isActive && { backgroundColor: rgba(tone, 0.12) }, hovered && !isActive && styles.hover]}>
        <View style={[styles.dot, { backgroundColor: isActive ? tone : '#cbd5e1' }]} />
        <Text style={[styles.childText, isActive && { color: tone, fontWeight: '700' }]} numberOfLines={1}>{node.title}</Text>
      </Pressable>
      {kids.map((k) => <Child key={k.id} node={k} active={active} tone={tone} onSelect={onSelect} depth={depth + 1} />)}
    </View>
  );
}

function Item({ node, index, active, expanded, onToggle, onSelect, collapsed, onExpandBar }) {
  const tone = toneFor(index);
  const kids = node.children || [];
  const isGroup = kids.length > 0;
  const isActive = isGroup ? hasActive(node, active.route) && !expanded[node.id] : active.route && active.route === node.route;
  const groupHasActive = isGroup && hasActive(node, active.route);
  const open = isGroup && expanded[node.id] && !collapsed;
  const press = () => {
    if (collapsed && isGroup) { onExpandBar(node.id); return; }
    if (isGroup) onToggle(node.id); else onSelect(node);
  };
  return (
    <View>
      <Pressable onPress={press} accessibilityLabel={node.title}
        style={({ hovered }) => [styles.item, collapsed && styles.itemCollapsed, (isActive || (groupHasActive && !open)) && { backgroundColor: rgba(tone, 0.12) }, hovered && !isActive && styles.hover]}>
        <View style={[styles.tile, { backgroundColor: tone }, (isActive || groupHasActive) && { ...glow(tone) }]}>
          <Icon name={node.icon} size={18} color="#fff" />
        </View>
        {!collapsed ? <Text style={[styles.itemText, (isActive || groupHasActive) && { color: tone, fontWeight: '700' }]} numberOfLines={1}>{node.title}</Text> : null}
        {isGroup && !collapsed ? (
          <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="chevron" size={16} color="#94a3b8" /></View>
        ) : null}
      </Pressable>
      {open ? <View style={{ marginBottom: 4 }}>{kids.map((k) => <Child key={k.id} node={k} active={active} tone={tone} onSelect={onSelect} />)}</View> : null}
    </View>
  );
}

const glow = (tone) => ({ boxShadow: `0 0 0 3px ${rgba(tone, 0.28)}`, shadowColor: tone, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 });

export default function ModernSidebar({ menu, active, expanded, onToggle, onSelect, onSearchSelect, collapsed = false, drawer = false, onExpandBar }) {
  const w = collapsed ? MODERN_SIDEBAR_COLLAPSED_W : MODERN_SIDEBAR_W;
  return (
    <View style={[styles.wrap, { width: w }, drawer && styles.drawer]}>
      <View style={[styles.brand, collapsed && { paddingHorizontal: 0 }]}>
        <BrandLogo height={collapsed ? 36 : 38} maxWidth={w - 36} iconOnly={collapsed} />
      </View>
      {!collapsed ? <View style={styles.search}><MenuSearch menu={menu} onSelect={onSearchSelect} variant="sidebar" /></View> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {menu.map((node, i) => (
          <Item key={node.id} node={node} index={i} active={active} expanded={expanded} onToggle={onToggle} onSelect={onSelect} collapsed={collapsed} onExpandBar={onExpandBar} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#fff', borderRightWidth: 1, borderRightColor: '#eef2f7', zIndex: 20, ...shadows.sm },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 40, height: '100%', ...shadows.pop },
  brand: { height: MODERN_HEADER_HEIGHT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  search: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, zIndex: 50 }, // the results list drops over the menu below
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 12, marginVertical: 3, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14 },
  itemCollapsed: { justifyContent: 'center', paddingHorizontal: 0, marginHorizontal: 14 },
  tile: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, color: '#334155', fontSize: 15, fontWeight: '600' },
  child: { flexDirection: 'row', alignItems: 'center', gap: 12, marginRight: 12, marginVertical: 1, paddingVertical: 9, paddingLeft: 36, paddingRight: 10, borderRadius: 10 },
  childText: { flex: 1, color: '#64748b', fontSize: 14, fontWeight: '500' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  hover: { backgroundColor: '#f8fafc' },
});
