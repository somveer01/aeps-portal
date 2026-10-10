import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Icon from '../components/Icon';
import BrandLogo from '../components/BrandLogo';
import MenuSearch from '../components/MenuSearch';
import { colors, shadows } from '../theme';

// Sidebar of the "Classic" layout for every panel. panel = 'admin' (icon chips, Expand / Collapse all, a compact name block) or
// 'retailer' (plain rows, the profile card the caller passes as profileBlock). The company logo band is the same height as the topbar.
export default function ClassicSidebar({ panel, menu, active, expanded, onToggle, onSelect, onSearchSelect, drawer, profileBlock, onExpandAll, onCollapseAll }) {
  const admin = panel === 'admin';
  const Node = admin ? AdminNode : RetailerNode;
  return (
    <View style={[styles.sidebar, drawer && styles.drawer]}>
      <View style={[styles.brandBand, { height: admin ? 48 : 58 }]}><BrandLogo height={admin ? 32 : 36} maxWidth={200} /></View>
      {profileBlock}
      <View style={styles.sideSearch}>
        <MenuSearch menu={menu} onSelect={onSearchSelect} variant="sidebar" />
      </View>
      {admin ? (
        <View style={styles.menuTools}>
          <Pressable onPress={onExpandAll} hitSlop={6}><Text style={styles.menuToolText}>Expand all</Text></Pressable>
          <Text style={styles.menuToolSep}>·</Text>
          <Pressable onPress={onCollapseAll} hitSlop={6}><Text style={styles.menuToolText}>Collapse all</Text></Pressable>
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
        {menu.map((node) => <Node key={node.id} node={node} active={active} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />)}
      </ScrollView>
    </View>
  );
}

function AdminNode({ node, active, expanded, onToggle, onSelect, depth = 0 }) {
  const hasChildren = node.children && node.children.length > 0;
  const isActive = active.route && active.route === node.route;
  const [hover, setHover] = useState(false);
  const isTop = depth === 0;
  const open = hasChildren && expanded[node.id];
  return (
    <View>
      <Pressable
        onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        onPress={() => (hasChildren ? onToggle(node.id) : onSelect(node))}
        style={[styles.link, isTop && styles.linkTop, isActive && styles.linkActive, hover && !isActive && styles.linkHover]}
      >
        {isActive && <View style={styles.activeBar} />}
        <View style={[styles.iconChip, isActive && styles.iconChipActive, hover && !isActive && styles.iconChipHover]}>
          <Icon name={node.icon} color={isActive ? colors.onActive : colors.primary} />
        </View>
        <Text style={[styles.linkText, isTop && styles.linkTextTop, isActive && styles.linkTextActive]} numberOfLines={1}>{node.title}</Text>
        {hasChildren && (
          <Text style={[styles.caret, (open || isActive) && styles.caretOpen, isActive && { color: colors.onActive }]}>⌄</Text>
        )}
      </Pressable>
      {open && (
        <View style={isTop ? styles.childWrap : null}>
          {node.children.map((c) => (
            <AdminNode key={c.id} node={c} active={active} expanded={expanded} onToggle={onToggle} onSelect={onSelect} depth={depth + 1} />
          ))}
        </View>
      )}
    </View>
  );
}

function RetailerNode({ node, active, expanded, onToggle, onSelect, depth = 0 }) {
  const hasChildren = node.children && node.children.length > 0;
  const isActive = active.route && active.route === node.route;
  const [hover, setHover] = useState(false);
  return (
    <View>
      <Pressable onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        onPress={() => (hasChildren ? onToggle(node.id) : onSelect(node))}
        style={[styles.rlink, { paddingLeft: 14 + depth * 14 }, isActive && styles.rlinkActive, hover && !isActive && styles.linkHover]}>
        <Icon name={node.icon} color={isActive ? colors.onActive : colors.primary} />
        <Text style={[styles.rlinkText, isActive && { color: colors.onActive, fontWeight: '600' }]} numberOfLines={1}>{node.title}</Text>
        {hasChildren && <Text style={[styles.rcaret, isActive && { color: colors.onActive }]}>{expanded[node.id] ? '⌄' : '›'}</Text>}
      </Pressable>
      {hasChildren && expanded[node.id] && node.children.map((c) => (
        <RetailerNode key={c.id} node={c} active={active} expanded={expanded} onToggle={onToggle} onSelect={onSelect} depth={depth + 1} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 264, backgroundColor: colors.sidebarBg, borderRightWidth: 1, borderRightColor: colors.sidebarBorder, ...shadows.sm },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 40, height: '100%', ...shadows.pop },
  brandBand: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: colors.sidebarBg, borderBottomWidth: 1, borderBottomColor: colors.sidebarBorder },
  sideSearch: { paddingHorizontal: 12, paddingTop: 12, zIndex: 50 },
  menuTools: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  menuToolText: { color: colors.primary, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  menuToolSep: { color: colors.muted, fontSize: 12 },

  // admin rows
  link: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, paddingLeft: 10, paddingRight: 12, marginHorizontal: 10, marginVertical: 1.5, borderRadius: 12, position: 'relative' },
  linkTop: { marginVertical: 2 },
  linkActive: { backgroundColor: colors.activeBg, ...shadows.card },
  linkHover: { backgroundColor: colors.primarySoft },
  linkText: { color: colors.sidebarText, flex: 1, fontSize: 13.5, fontWeight: '500' },
  linkTextTop: { fontSize: 14, fontWeight: '600', color: colors.text },
  linkTextActive: { color: colors.onActive, fontWeight: '700' },
  activeBar: { position: 'absolute', left: -10, top: 9, bottom: 9, width: 3.5, borderRadius: 4, backgroundColor: colors.activeBg },
  iconChip: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  iconChipActive: { backgroundColor: colors.onActive === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.10)' },
  iconChipHover: { backgroundColor: '#ffffff' },
  childWrap: { marginLeft: 25, borderLeftWidth: 1.5, borderLeftColor: colors.sidebarBorder, paddingLeft: 2, marginTop: 1, marginBottom: 5 },
  caret: { color: colors.muted, fontSize: 15, transform: [{ rotate: '-90deg' }] },
  caretOpen: { transform: [{ rotate: '0deg' }] },

  // retailer rows
  rlink: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingRight: 12, marginHorizontal: 10, marginVertical: 1, borderRadius: 10 },
  rlinkActive: { backgroundColor: colors.activeBg, ...shadows.sm },
  rlinkText: { color: colors.sidebarText, flex: 1, fontSize: 14, fontWeight: '500' },
  rcaret: { color: colors.muted, fontSize: 16 },
});
