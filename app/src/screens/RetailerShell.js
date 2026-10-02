import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useWindowDimensions, ActivityIndicator, Modal } from 'react-native';
import Icon from '../components/Icon';
import MenuSearch from '../components/MenuSearch';
import { Card } from '../components/UI';
import { api } from '../api/client';
import { colors, radius, shadows } from '../theme';

import RetailerDashboard from './retailer/RetailerDashboard';
import ServicesScreen from './retailer/ServicesScreen';
import MobileRechargeScreen from './retailer/MobileRechargeScreen';
import DthRechargeScreen from './retailer/DthRechargeScreen';
import BillPaymentScreen from './retailer/BillPaymentScreen';
import AepsScreen from './retailer/AepsScreen';
import MoneyTransferScreen from './retailer/MoneyTransferScreen';
import PayServiceScreen from './retailer/PayServiceScreen';
import BookingScreen from './retailer/BookingScreen';
import RetailerReportScreen from './retailer/RetailerReportScreen';
import MyCommissionSlabScreen from './retailer/MyCommissionSlabScreen';
import SupportTicketScreen from './retailer/SupportTicketScreen';
import SimplePage from './retailer/SimplePage';
// Distributor / MD panel reuses the admin screens in their network mode.
import UserManagerScreen from './UserManagerScreen';
import FundTransferScreen from './FundTransferScreen';
import FundTransferListScreen from './FundTransferListScreen';
import ServiceReportScreen from './ServiceReportScreen';
import FundRequestScreen from './FundRequestScreen';
import KycScreen from './retailer/KycScreen';

function initials(user) {
  const src = (user?.fullName || user?.username || '').trim();
  if (!src) return '?';
  const p = src.split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[1][0] : src.slice(0, 2)).toUpperCase();
}
const money = (v) => (v == null ? '₹0.00' : `₹${Number(v).toFixed(2)}`);

export default function RetailerShell({ user, onLogout }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState({ title: 'Dashboard', route: '/' });
  const [expanded, setExpanded] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [summary, setSummary] = useState(null);

  const loadSummary = useCallback(() => { api.retailer.summary().then(setSummary).catch(() => {}); }, []);
  useEffect(() => {
    api.menu().then(({ menu }) => setMenu(menu)).catch(() => {}).finally(() => setLoading(false));
    loadSummary();
  }, [loadSummary]);

  const go = (route, title) => { setActive({ route, title }); if (!isWide) setDrawerOpen(false); loadSummary(); };
  const doLogout = () => { api.account.logout().catch(() => {}).finally(() => onLogout()); };
  const onSelect = (item) => { if (item.route === '/logout') return doLogout(); go(item.route, item.title); };
  const onSearchSelect = (node, ancestorIds) => {
    setExpanded((e) => { const n = { ...e }; ancestorIds.forEach((id) => { n[id] = true; }); return n; });
    onSelect(node);
  };

  const Sidebar = (
    <View style={[styles.sidebar, !isWide && styles.drawer]}>
      <View style={styles.profile}>
        <View style={styles.profileBanner} />
        <View style={styles.avatarLg}><Text style={styles.avatarLgText}>{initials(user)}</Text></View>
        <Text style={styles.profileName}>{summary?.name || user.fullName || user.username}</Text>
        <View style={styles.roleRow}>
          <Text style={styles.profileRole}>{summary?.userTypeName || 'Retailer'}</Text>
          {summary?.kycStatus === 'verified' ? <Text style={styles.kyc}>· KYC ✓</Text> : summary?.kycStatus === 'rejected' ? <Text style={styles.kycRej}>· KYC ✗</Text> : <Text style={styles.kycPend}>· KYC ⏳</Text>}
        </View>
        <View style={styles.balances}><Text style={styles.balanceLine}>Balance: <Text style={styles.balanceAmt}>{money(summary?.balance)}</Text></Text></View>
      </View>
      <View style={styles.sideSearch}>
        <MenuSearch menu={menu} onSelect={onSearchSelect} variant="sidebar" />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
        {menu.map((node) => (
          <MenuNode key={node.id} node={node} active={active} expanded={expanded}
            onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))} onSelect={onSelect} />
        ))}
      </ScrollView>
    </View>
  );

  const back = () => go('/services', 'Services');
  const renderContent = () => {
    const r = active.route;
    if (r === '/') return <RetailerDashboard onOpen={go} />;
    if (r === '/services') return <ServicesScreen onOpen={(route, title) => go(route, title)} />;
    if (r === '/services/mobile-recharge') return <MobileRechargeScreen onBack={back} onDone={loadSummary} />;
    if (r === '/services/dth-recharge') return <DthRechargeScreen onBack={back} onDone={loadSummary} />;
    if (r === '/services/bill-payment') return <BillPaymentScreen onBack={back} onDone={loadSummary} />;
    if (r === '/services/aeps') return <AepsScreen kind="aeps" onBack={back} onDone={loadSummary} />;
    if (r === '/services/aadhar-pay') return <AepsScreen kind="aadhar-pay" onBack={back} onDone={loadSummary} />;
    if (r === '/services/micro-atm') return <AepsScreen kind="micro-atm" onBack={back} onDone={loadSummary} />;
    if (r === '/services/money-transfer') return <MoneyTransferScreen onBack={back} onDone={loadSummary} />;
    if (r === '/services/lic-payment') return <PayServiceScreen kind="lic" title="LIC Payment" onBack={back} onDone={loadSummary} />;
    if (r === '/services/gas-booking') return <PayServiceScreen kind="gas" title="Gas Booking" onBack={back} onDone={loadSummary} />;
    if (r === '/services/fastag') return <PayServiceScreen kind="fastag" title="FASTag Recharge" onBack={back} onDone={loadSummary} />;
    if (r === '/services/move-to-bank') return <PayServiceScreen kind="moveToBank" title="Move To Bank" onBack={back} onDone={loadSummary} />;
    if (r === '/services/flight') return <BookingScreen type="flight" onBack={back} onDone={loadSummary} />;
    if (r === '/services/hotel') return <BookingScreen type="hotel" onBack={back} onDone={loadSummary} />;
    if (r === '/services/bus') return <BookingScreen type="bus" onBack={back} onDone={loadSummary} />;
    if (r === '/fund-request' || r === '/services/fund-request') return <FundRequestScreen mode="mine" onDone={loadSummary} />;
    if (r.startsWith('/services/')) return <SimplePage title={active.title} note="This service will be enabled in a later phase (the API pipeline is ready)." onBack={back} />;
    if (r === '/network/users') return <UserManagerScreen network onDone={loadSummary} />;
    if (r === '/network/fund-transfer') return <FundTransferScreen network onDone={loadSummary} />;
    if (r === '/network/fund-transfers') return <FundTransferListScreen network />;
    if (r === '/network/report') return <ServiceReportScreen network />;
    if (r === '/network/fund-requests') return <FundRequestScreen mode="network" onDone={loadSummary} />;
    if (r === '/account-history') return <RetailerReportScreen key="accountHistory" kind="accountHistory" />;
    if (r === '/service-report') return <RetailerReportScreen key="serviceReport" kind="serviceReport" />;
    if (r === '/gst-report') return <RetailerReportScreen key="gst" kind="gst" />;
    if (r === '/tds-report') return <RetailerReportScreen key="tds" kind="tds" />;
    if (r === '/commission-report') return <RetailerReportScreen key="commission" kind="commission" />;
    if (r === '/my-commission-slab') return <MyCommissionSlabScreen />;
    if (r === '/support-ticket') return <SupportTicketScreen />;
    if (r === '/profile') return <SimplePage title="Profile" note={`${summary?.shopName || ''}\nUser ID: ${summary?.userCode || user.username}\nName: ${summary?.name || user.fullName}`} />;
    if (r === '/kyc') return <KycScreen onDone={loadSummary} />;
    if (r === '/account-settings') {
      const ChangePasswordScreen = require('./ChangePasswordScreen').default;
      return <ChangePasswordScreen onDone={onLogout} />;
    }
    return <SimplePage title={active.title} note="Screen coming soon." />;
  };

  return (
    <View style={styles.root}>
      {isWide && Sidebar}
      {!isWide && drawerOpen && (<><Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)} />{Sidebar}</>)}
      <View style={styles.main}>
        <View style={styles.topbar}>
          {!isWide && <Pressable onPress={() => setDrawerOpen(true)} style={styles.hamburger}><Text style={{ fontSize: 22, color: '#fff' }}>☰</Text></Pressable>}
          <Text style={styles.topbarBrand} numberOfLines={1}>Welcome to AEPS Portal — {summary?.userTypeName || 'Retailer'}</Text>
          {isWide && <MenuSearch menu={menu} onSelect={onSearchSelect} variant="topbar" style={styles.topSearch} />}
          <View style={{ flex: 1 }} />
          <Pressable style={styles.userChip} onPress={() => setUserMenu(true)}>
            <View style={styles.avatarSm}><Text style={styles.avatarSmText}>{initials(user)}</Text></View>
            <Text style={styles.userChipName} numberOfLines={1}>{user.fullName || user.username}</Text>
            <Text style={{ color: '#fff' }}>▾</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Text style={styles.h1}>{active.title}</Text>
          {loading ? <ActivityIndicator color={colors.primary} /> : renderContent()}
        </ScrollView>
      </View>
      <Modal visible={userMenu} transparent animationType="fade" onRequestClose={() => setUserMenu(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setUserMenu(false)}>
          <View style={styles.userDropdown}>
            <View style={styles.dropHead}><Text style={styles.dropName}>{user.fullName || user.username}</Text><Text style={styles.dropRole}>{summary?.userTypeName || 'Retailer'}</Text></View>
            <Pressable style={styles.dropItem} onPress={() => { setUserMenu(false); doLogout(); }}><Text style={{ color: colors.danger, fontWeight: '600' }}>Logout</Text></Pressable>
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
      <Pressable onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        onPress={() => (hasChildren ? onToggle(node.id) : onSelect(node))}
        style={[styles.link, { paddingLeft: 14 + depth * 14 }, isActive && styles.linkActive, hover && !isActive && styles.linkHover]}>
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

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.contentBg },
  sidebar: { width: 264, backgroundColor: colors.sidebarBg, borderRightWidth: 1, borderRightColor: colors.sidebarBorder, ...shadows.sm },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 40, height: '100%', ...shadows.pop },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.5)', zIndex: 30 },
  profile: { alignItems: 'center', paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.sidebarBorder },
  profileBanner: { height: 72, alignSelf: 'stretch', backgroundColor: colors.primary, boxShadow: `inset 0 -30px 40px ${colors.primaryDark}` },
  avatarLg: { width: 86, height: 86, borderRadius: 43, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: -46, borderWidth: 4, borderColor: '#fff', ...shadows.card },
  avatarLgText: { color: '#fff', fontWeight: '800', fontSize: 28 },
  profileName: { fontWeight: '800', color: colors.text, marginTop: 10, fontSize: 15.5 },
  roleRow: { flexDirection: 'row', gap: 4, marginTop: 2 },
  profileRole: { color: colors.muted, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.6 },
  kyc: { color: colors.success, fontSize: 11.5, fontWeight: '700' },
  kycPend: { color: colors.warning, fontSize: 11.5, fontWeight: '700' },
  kycRej: { color: colors.danger, fontSize: 11.5, fontWeight: '700' },
  balances: { marginTop: 12, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 16 },
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
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.topbarBg, paddingHorizontal: 18, paddingVertical: 12, minHeight: 58, zIndex: 10, ...shadows.card },
  hamburger: { padding: 4 },
  topbarBrand: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  userChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 22, paddingVertical: 5, paddingHorizontal: 8, maxWidth: 200, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  avatarSm: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  avatarSmText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  userChipName: { color: '#fff', fontWeight: '600', flexShrink: 1 },
  menuBackdrop: { flex: 1 },
  userDropdown: { position: 'absolute', top: 58, right: 16, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minWidth: 180, ...shadows.pop, overflow: 'hidden' },
  dropHead: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  dropName: { fontWeight: '700', color: colors.text }, dropRole: { color: colors.muted, fontSize: 12 },
  dropItem: { padding: 12 },
  content: { padding: 26, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  h1: { fontSize: 23, fontWeight: '800', marginBottom: 20, color: colors.text, letterSpacing: -0.2 },
});
