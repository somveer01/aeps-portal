import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import AccountMenu from '../components/AccountMenu';
import ModernSidebar from '../components/ModernSidebar';
import ModernHeader from '../components/ModernHeader';
import ClassicSidebar from './ClassicSidebar';
import ClassicHeader from './ClassicHeader';
import { colors, ui } from '../theme';

// The one shell every panel uses (admin, distributor / super distributor, retailer, employees): sidebar + header + content area
// + account menu, in the Classic or the Modern layout (Application Settings -> Layout style). A panel passes only what is its own:
//   panel            'admin' | 'retailer' (small Classic differences: row style, header height, where the search sits)
//   core             the object from useShellCore()
//   header           { name, photo, role, brandText, balanceText, onWallet, onSettings, onUser }
//   profileBlock     the Classic sidebar's profile area (admin: name + role, retailer: avatar card)
//   accountMenu      { profile, balance, onRefresh, walletAction, onManage, onLogout, items }
//   onSelect         open a menu item (the panel also refreshes its wallet balance there)
//   title            node shown above the screen (or null)
//   children         the screen for the active route
export default function AppShell({ panel, core, header, profileBlock, accountMenu, onSelect, title, children }) {
  const { isWide, menu, loading, error, active, expanded, drawerOpen, setDrawerOpen, userMenu, setUserMenu, collapsed, setCollapsed } = core;
  const modern = ui.layout === 'modern';
  const admin = panel === 'admin';

  const onSearchSelect = (node, ancestorIds) => { core.expandGroups(ancestorIds); onSelect(node); };

  const sidebar = modern ? (
    <ModernSidebar
      menu={menu} active={active} expanded={expanded} collapsed={isWide && collapsed} drawer={!isWide}
      onToggle={core.toggleGroup} onSelect={onSelect} onSearchSelect={onSearchSelect}
      onExpandBar={(id) => { setCollapsed(false); core.expandGroups([id]); }}
    />
  ) : (
    <ClassicSidebar
      panel={panel} menu={menu} active={active} expanded={expanded} onToggle={core.toggleGroup} onSelect={onSelect}
      onSearchSelect={onSearchSelect} drawer={!isWide} profileBlock={profileBlock}
      onExpandAll={core.expandEvery} onCollapseAll={core.collapseEvery}
    />
  );

  return (
    <View style={styles.root}>
      {isWide && sidebar}
      {!isWide && drawerOpen && (
        <>
          <Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)} />
          {sidebar}
        </>
      )}

      <View style={styles.main}>
        {modern ? (
          <ModernHeader
            isWide={isWide} onToggle={() => (isWide ? setCollapsed((c) => !c) : setDrawerOpen(true))}
            appName={core.appName} balanceText={header.balanceText} onWallet={header.onWallet} onSettings={header.onSettings}
            name={header.name} role={header.role} photo={header.photo} onUser={header.onUser}
            menu={menu} onSearchSelect={onSearchSelect} showSearch={isWide && collapsed}
          />
        ) : (
          <ClassicHeader
            panel={panel} isWide={isWide} onMenu={() => setDrawerOpen(true)} brandText={header.brandText}
            menu={menu} onSearchSelect={onSearchSelect} balanceText={header.balanceText} onWallet={header.onWallet}
            name={header.name} photo={header.photo} onUser={header.onUser}
          />
        )}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={admin ? styles.contentAdmin : styles.contentRetailer}>
          {title}
          {loading && admin ? <ActivityIndicator color={colors.primary} /> : null}
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          {loading && !admin ? <ActivityIndicator color={colors.primary} /> : children}
        </ScrollView>
      </View>

      <AccountMenu
        visible={userMenu}
        onClose={() => setUserMenu(false)}
        profile={accountMenu.profile}
        balance={accountMenu.balance}
        onRefresh={accountMenu.onRefresh}
        walletAction={accountMenu.walletAction}
        onManage={accountMenu.onManage}
        onLogout={accountMenu.onLogout}
        items={accountMenu.items}
      />
    </View>
  );
}

// Heading above a screen, as each panel always showed it.
export function ScreenTitle({ panel, text, module }) {
  if (panel === 'admin') {
    return (
      <Text style={styles.h1Admin} numberOfLines={1}>
        {module ? `${module}  ›  ` : ''}
        <Text style={styles.h1AdminScreen}>{text}</Text>
      </Text>
    );
  }
  return <Text style={styles.h1Retailer}>{text}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.contentBg },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.5)', zIndex: 30 },
  main: { flex: 1 },
  contentAdmin: { paddingHorizontal: 13, paddingVertical: 10, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  contentRetailer: { padding: 26, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  h1Admin: { fontSize: 12, fontWeight: '800', marginBottom: 8, color: colors.text, letterSpacing: 0.1 },
  h1AdminScreen: { fontSize: 12, fontWeight: '800', color: colors.text },
  h1Retailer: { fontSize: 23, fontWeight: '800', marginBottom: 20, color: colors.text, letterSpacing: -0.2 },
});
