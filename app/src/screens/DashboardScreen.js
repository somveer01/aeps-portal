import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useWindowDimensions, ActivityIndicator, Modal,
} from 'react-native';
import Icon from '../components/Icon';
import MenuSearch from '../components/MenuSearch';
import { Card } from '../components/UI';
import SettingsScreen from './SettingsScreen';
import ServiceCategoryScreen from './ServiceCategoryScreen';
import CityMasterScreen from './CityMasterScreen';
import UserTypeMasterScreen from './UserTypeMasterScreen';
import ServiceMasterScreen from './ServiceMasterScreen';
import PlanMasterScreen from './PlanMasterScreen';
import CommissionSlotScreen from './CommissionSlotScreen';
import ApplicationBannerScreen from './ApplicationBannerScreen';
import TicketDepartmentScreen from './TicketDepartmentScreen';
import AnnouncementScreen from './AnnouncementScreen';
import CompanyBankScreen from './CompanyBankScreen';
import UserManagerScreen from './UserManagerScreen';
import AccountHistoryScreen from './AccountHistoryScreen';
import ServiceReportScreen from './ServiceReportScreen';
import FundRequestScreen from './FundRequestScreen';
import PayoutBankScreen from './PayoutBankScreen';
import FundTransferScreen from './FundTransferScreen';
import FundTransferListScreen from './FundTransferListScreen';
import PanVerifyScreen from './PanVerifyScreen';
import AadhaarVerifyScreen from './AadhaarVerifyScreen';
import CommissionSlabScreen from './CommissionSlabScreen';
import TaxReportScreen from './TaxReportScreen';
import AdminMarginScreen from './AdminMarginScreen';
import AdminWalletAddScreen from './AdminWalletAddScreen';
import AdminWalletListScreen from './AdminWalletListScreen';
import ChangePasswordScreen from './ChangePasswordScreen';
import TxnPinScreen from './TxnPinScreen';
import RetailerPanelScreen from './RetailerPanelScreen';
import SupportTicketScreen from './SupportTicketScreen';
import { api } from '../api/client';
import { colors, radius, shadows } from '../theme';

function initials(user) {
  const src = (user?.fullName || user?.username || '').trim();
  if (!src) return '?';
  const parts = src.split(/\s+/);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return s.toUpperCase();
}

export default function DashboardScreen({ user, onLogout }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState({ title: 'Dashboard', route: '/' });
  const [expanded, setExpanded] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { menu } = await api.menu();
        setMenu(menu);
        const exp = {};
        menu.forEach((m) => { if (m.children?.length) exp[m.id] = true; });
        setExpanded(exp);
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    })();
    // Active announcements shown as a banner on the dashboard.
    api.announcements.active().then((r) => setAnnouncements(r.rows || [])).catch(() => {});
    api.adminWallet.balance().then((r) => setBalance(r.balance)).catch(() => {});
  }, []);

  // Revoke the token server-side (best-effort), then clear the local session.
  const doLogout = () => { api.account.logout().catch(() => {}).finally(() => onLogout()); };

  const selForm = (item) => {
    if (item.route === '/logout') { doLogout(); return; }
    setActive(item);
    if (!isWide) setDrawerOpen(false);
    // Refresh the wallet balance when leaving a wallet screen (Add Fund may have changed it).
    api.adminWallet.balance().then((r) => setBalance(r.balance)).catch(() => {});
  };

  const onSearchSelect = (node, ancestorIds) => {
    setExpanded((e) => { const n = { ...e }; ancestorIds.forEach((id) => { n[id] = true; }); return n; });
    selForm(node);
  };

  const money = (v) => (v === null || v === undefined ? '₹0.00' : `₹${Number(v).toFixed(2)}`);

  const Sidebar = (
    <View style={[styles.sidebar, !isWide && styles.drawer]}>
      {/* Profile card */}
      <View style={styles.profile}>
        <View style={styles.profileBanner} />
        <View style={styles.avatarLg}><Text style={styles.avatarLgText}>{initials(user)}</Text></View>
        <Text style={styles.profileName}>{user.fullName || user.username}</Text>
        <Text style={styles.profileRole}>{user.role}</Text>
        <View style={styles.balances}>
          <Text style={styles.balanceLine}>Wallet Balance: <Text style={styles.balanceAmt}>{money(balance)}</Text></Text>
        </View>
      </View>

      <View style={styles.sideSearch}>
        <MenuSearch menu={menu} onSelect={onSearchSelect} variant="sidebar" />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
        {menu.map((node) => (
          <MenuNode key={node.id} node={node} active={active} expanded={expanded}
            onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))} onSelect={selForm} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* Sidebar */}
      {isWide && Sidebar}
      {!isWide && drawerOpen && (
        <>
          <Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)} />
          {Sidebar}
        </>
      )}

      <View style={styles.main}>
        {/* Topbar (blue) */}
        <View style={styles.topbar}>
          {!isWide && (
            <Pressable onPress={() => setDrawerOpen(true)} style={styles.hamburger}>
              <Text style={{ fontSize: 22, color: '#fff' }}>☰</Text>
            </Pressable>
          )}
          <Text style={styles.topbarBrand}>AEPS Portal</Text>
          {isWide && <MenuSearch menu={menu} onSelect={onSearchSelect} variant="topbar" style={styles.topSearch} />}
          <View style={{ flex: 1 }} />
          <Pressable style={styles.userChip} onPress={() => setUserMenu(true)}>
            <View style={styles.avatarSm}><Text style={styles.avatarSmText}>{initials(user)}</Text></View>
            <Text style={styles.userChipName} numberOfLines={1}>{user.fullName || user.username}</Text>
            <Text style={{ color: '#fff' }}>▾</Text>
          </Pressable>
        </View>

        {/* Content */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Text style={styles.h1}>{active.title}</Text>
          {loading && <ActivityIndicator color={colors.primary} />}
          {error && <Text style={{ color: colors.danger }}>{error}</Text>}

          {active.route === '/modules/settings' ? (
            <SettingsScreen />
          ) : active.route === '/modules/service-category' ? (
            <ServiceCategoryScreen />
          ) : active.route === '/modules/city-master' ? (
            <CityMasterScreen />
          ) : active.route === '/modules/user-type-master' ? (
            <UserTypeMasterScreen />
          ) : active.route === '/modules/service-master' ? (
            <ServiceMasterScreen />
          ) : active.route === '/modules/plan-master' ? (
            <PlanMasterScreen />
          ) : active.route === '/modules/commission-slots' ? (
            <CommissionSlotScreen />
          ) : active.route === '/modules/application-banners' ? (
            <ApplicationBannerScreen />
          ) : active.route === '/modules/ticket-departments' ? (
            <TicketDepartmentScreen />
          ) : active.route === '/modules/announcements' ? (
            <AnnouncementScreen />
          ) : active.route === '/company-banks' ? (
            <CompanyBankScreen />
          ) : active.route === '/users-manager' ? (
            <UserManagerScreen />
          ) : active.route === '/account-history' ? (
            <AccountHistoryScreen />
          ) : active.route === '/service-report' ? (
            <ServiceReportScreen />
          ) : active.route === '/fund-requests' ? (
            <FundRequestScreen />
          ) : active.route === '/payout-banks' ? (
            <PayoutBankScreen />
          ) : active.route === '/fund-transfer' ? (
            <FundTransferScreen />
          ) : active.route === '/fund-transfers' ? (
            <FundTransferListScreen />
          ) : active.route === '/pan-verify' ? (
            <PanVerifyScreen />
          ) : active.route === '/aadhaar-verify' ? (
            <AadhaarVerifyScreen />
          ) : active.route === '/commission-slab' ? (
            <CommissionSlabScreen />
          ) : active.route === '/gst-report' ? (
            <TaxReportScreen kind="gst" />
          ) : active.route === '/tds-report' ? (
            <TaxReportScreen kind="tds" />
          ) : active.route === '/admin-margin' ? (
            <AdminMarginScreen />
          ) : active.route === '/admin-wallet/add' ? (
            <AdminWalletAddScreen />
          ) : active.route === '/admin-wallet/all' ? (
            <AdminWalletListScreen />
          ) : active.route === '/change-password' ? (
            <ChangePasswordScreen onDone={onLogout} />
          ) : active.route === '/txn-pin' ? (
            <TxnPinScreen />
          ) : active.route === '/retailer-panel' ? (
            <RetailerPanelScreen />
          ) : active.route === '/support-tickets' ? (
            <SupportTicketScreen />
          ) : active.route === '/' ? (
            <>
              <NoticeBanner items={announcements} />
              <View style={styles.cards}>
                <Stat label="Today's Transactions" value="0" />
                <Stat label="Total Balance" value="₹0.00" />
                <Stat label="Active Services" value="6" />
                <Stat label="Pending KYC" value="0" />
              </View>
              <Card style={{ marginTop: 16 }}>
                <Text style={styles.cardTitle}>Welcome, {user.fullName} 👋</Text>
                <Text style={styles.para}>
                  This is the AEPS Portal admin dashboard, built with React Native (web + Android +
                  iOS). The menu on the left is loaded from the database — add or reorder rows in
                  <Text style={styles.code}> menu_items</Text> and it updates here.
                </Text>
              </Card>
            </>
          ) : (
            <Card>
              <Text style={styles.cardTitle}>{active.title}</Text>
              <Text style={styles.para}>
                Placeholder screen for <Text style={{ fontWeight: '700' }}>{active.title}</Text>
                {' '}(<Text style={styles.code}>{active.route}</Text>). To be built in a later phase.
              </Text>
            </Card>
          )}
        </ScrollView>
      </View>

      {/* User dropdown */}
      <Modal visible={userMenu} transparent animationType="fade" onRequestClose={() => setUserMenu(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setUserMenu(false)}>
          <View style={styles.userDropdown}>
            <View style={styles.dropHead}>
              <Text style={styles.dropName}>{user.fullName || user.username}</Text>
              <Text style={styles.dropRole}>{user.role}</Text>
            </View>
            <Pressable style={styles.dropItem} onPress={() => { setUserMenu(false); doLogout(); }}>
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Logout</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function MenuNode({ node, active, expanded, onToggle, onSelect, depth = 0 }) {
  const hasChildren = node.children && node.children.length > 0;
  const isActive = active.route && active.route === node.route;
  const [hover, setHover] = useState(false);
  return (
    <View>
      <Pressable
        onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        onPress={() => (hasChildren ? onToggle(node.id) : onSelect(node))}
        style={[styles.link, { paddingLeft: 14 + depth * 14 }, isActive && styles.linkActive, hover && !isActive && styles.linkHover]}
      >
        <Icon name={node.icon} color={isActive ? '#fff' : colors.primary} />
        <Text style={[styles.linkText, isActive && { color: '#fff', fontWeight: '600' }]} numberOfLines={1}>{node.title}</Text>
        {hasChildren && <Text style={[styles.caret, isActive && { color: '#fff' }]}>{expanded[node.id] ? '⌄' : '›'}</Text>}
      </Pressable>
      {hasChildren && expanded[node.id] && node.children.map((c) => (
        <MenuNode key={c.id} node={c} active={active} expanded={expanded} onToggle={onToggle} onSelect={onSelect} depth={depth + 1} />
      ))}
    </View>
  );
}

function NoticeBanner({ items }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!items || items.length <= 1) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 4000);
    return () => clearInterval(t);
  }, [items]);
  if (!items || items.length === 0) return null;
  const cur = items[idx % items.length];
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeIcon}>📢</Text>
      <Text style={styles.noticeText} numberOfLines={2}>{cur.message}</Text>
      {items.length > 1 ? <Text style={styles.noticeCount}>{(idx % items.length) + 1}/{items.length}</Text> : null}
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.contentBg },

  // Sidebar (white)
  sidebar: { width: 264, backgroundColor: colors.sidebarBg, borderRightWidth: 1, borderRightColor: colors.sidebarBorder, ...shadows.sm },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 40, height: '100%', ...shadows.pop },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.5)', zIndex: 30 },

  profile: { alignItems: 'center', paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.sidebarBorder },
  profileBanner: { height: 72, alignSelf: 'stretch', backgroundColor: colors.primary, boxShadow: `inset 0 -30px 40px ${colors.primaryDark}` },
  avatarLg: { width: 86, height: 86, borderRadius: 43, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: -46, borderWidth: 4, borderColor: '#fff', ...shadows.card },
  avatarLgText: { color: '#fff', fontWeight: '800', fontSize: 28 },
  profileName: { fontWeight: '800', color: colors.text, marginTop: 10, fontSize: 15.5 },
  profileRole: { color: colors.muted, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 1 },
  balances: { marginTop: 12, alignItems: 'center', gap: 2, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 16 },
  balanceLine: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  balanceAmt: { color: colors.primary, fontWeight: '800', fontSize: 14 },

  sideSearch: { paddingHorizontal: 12, paddingTop: 12, zIndex: 50 },
  topSearch: { flex: 1, maxWidth: 420, marginLeft: 12 },

  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingRight: 12, marginHorizontal: 10, marginVertical: 1, borderRadius: 10 },
  linkActive: { backgroundColor: colors.secondary, ...shadows.sm },
  linkHover: { backgroundColor: colors.primarySoft },
  linkText: { color: colors.sidebarText, flex: 1, fontSize: 14, fontWeight: '500' },
  caret: { color: colors.muted, fontSize: 16 },

  main: { flex: 1 },

  // Topbar (blue)
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.topbarBg, paddingHorizontal: 18, paddingVertical: 12, minHeight: 58, zIndex: 10, ...shadows.card },
  hamburger: { padding: 4 },
  topbarBrand: { color: '#fff', fontWeight: '800', fontSize: 17, letterSpacing: 0.3 },
  userChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 22, paddingVertical: 5, paddingHorizontal: 8, maxWidth: 200, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  avatarSm: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  avatarSmText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  userChipName: { color: '#fff', fontWeight: '600', flexShrink: 1 },

  menuBackdrop: { flex: 1 },
  userDropdown: { position: 'absolute', top: 58, right: 16, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minWidth: 180, shadowColor: '#0f172a', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6, overflow: 'hidden' },
  dropHead: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  dropName: { fontWeight: '700', color: colors.text },
  dropRole: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
  dropItem: { padding: 12 },

  content: { padding: 26, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  h1: { fontSize: 23, fontWeight: '800', marginBottom: 20, color: colors.text, letterSpacing: -0.2 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#bfdbfe', borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 18, ...shadows.sm },
  noticeIcon: { fontSize: 18 },
  noticeText: { flex: 1, color: colors.primaryDark, fontWeight: '600' },
  noticeCount: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  stat: { flexGrow: 1, minWidth: 200, gap: 6, borderTopWidth: 3, borderTopColor: colors.primary },
  statLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  cardTitle: { fontSize: 17, fontWeight: '800', marginBottom: 10, color: colors.text },
  para: { color: colors.text, lineHeight: 21 },
  code: { fontFamily: 'monospace', backgroundColor: '#eef1f6', color: colors.text },
});
