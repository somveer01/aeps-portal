import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Avatar from '../components/Avatar';
import AppShell, { ScreenTitle } from '../shell/AppShell';
import useShellCore from '../shell/useShellCore';
import { api } from '../api/client';
import { colors, shadows, ui } from '../theme';

import ProfileScreen from './ProfileScreen';
import TxnPinScreen from './TxnPinScreen';
import RetailerDashboard from './retailer/RetailerDashboard';
import ModernRetailerDashboard from './retailer/ModernRetailerDashboard';
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
import UserManagerScreen from './UserManagerScreen';
import FundTransferScreen from './FundTransferScreen';
import FundTransferListScreen from './FundTransferListScreen';
import ServiceReportScreen from './ServiceReportScreen';
import FundRequestScreen from './FundRequestScreen';
import CommissionPackageScreen from './CommissionPackageScreen';
import KycScreen from './retailer/KycScreen';

const money = (v) => (v == null ? '₹0.00' : `₹${Number(v).toFixed(2)}`);

// The distributor / super distributor / retailer / employee panel: the shell (sidebar, header, account menu, Classic / Modern layout)
// is the shared AppShell; this file only knows these routes -> screens and where the wallet balance comes from.
export default function RetailerShell({ user, onLogout }) {
  const core = useShellCore({ expandAll: false });
  const modern = ui.layout === 'modern';
  const { active, profile, setProfile } = core;
  const [summary, setSummary] = useState(null);

  const loadSummary = useCallback(() => { api.retailer.summary().then(setSummary).catch(() => {}); }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const go = (route, title) => { core.open({ route, title }); loadSummary(); };
  const doLogout = () => { api.account.logout().catch(() => {}).finally(() => onLogout()); };
  const onSelect = (item) => { if (item.route === '/logout') return doLogout(); return go(item.route, item.title); };
  const name = profile?.fullName || user.fullName || user.username;
  const typeName = summary?.userTypeName || 'Retailer';

  const back = () => go('/services', 'Services');
  const renderContent = () => {
    const r = active.route;
    if (r === '/') return modern ? <ModernRetailerDashboard onOpen={go} /> : <RetailerDashboard onOpen={go} />;
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
    if (r === '/network/packages') return <CommissionPackageScreen />;
    if (r === '/network/fund-requests') return <FundRequestScreen mode="network" onDone={loadSummary} />;
    if (r === '/account-history') return <RetailerReportScreen key="accountHistory" kind="accountHistory" />;
    if (r === '/service-report') return <RetailerReportScreen key="serviceReport" kind="serviceReport" />;
    if (r === '/gst-report') return <RetailerReportScreen key="gst" kind="gst" />;
    if (r === '/tds-report') return <RetailerReportScreen key="tds" kind="tds" />;
    if (r === '/commission-report') return <RetailerReportScreen key="commission" kind="commission" />;
    if (r === '/my-commission-slab') return <MyCommissionSlabScreen />;
    if (r === '/support-ticket') return <SupportTicketScreen />;
    if (r === '/profile') {
      return (
        <ProfileScreen onChanged={(p) => { setProfile(p); loadSummary(); }} onLogout={onLogout}
          goTo={(route) => go(route, route === '/account-settings' ? 'Change Password' : route === '/txn-pin' ? 'Transaction PIN' : 'Account History')}
          routes={{ password: '/account-settings', pin: '/txn-pin', statement: '/account-history' }} statementLabel="Account history" />
      );
    }
    if (r === '/txn-pin') return <TxnPinScreen />;
    if (r === '/kyc') return <KycScreen onDone={loadSummary} />;
    if (r === '/account-settings') {
      const ChangePasswordScreen = require('./ChangePasswordScreen').default;
      return <ChangePasswordScreen onDone={onLogout} />;
    }
    return <SimplePage title={active.title} note="Screen coming soon." />;
  };

  return (
    <AppShell
      panel="retailer"
      core={core}
      onSelect={onSelect}
      header={{
        name, photo: profile?.photo, role: typeName, brandText: `Welcome to AEPS Portal — ${typeName}`, balanceText: money(summary?.balance),
        onWallet: () => go('/account-history', 'Account History'),
        onSettings: () => go('/profile', 'My Profile'),
        onUser: () => { core.setUserMenu(true); loadSummary(); },
      }}
      profileBlock={(
        <View style={styles.profile}>
          <View style={styles.profileBanner} />
          <View style={styles.avatarLg}><Avatar photo={profile?.photo} name={name} size={78} /></View>
          <Text style={styles.profileName}>{summary?.name || user.fullName || user.username}</Text>
          <View style={styles.roleRow}>
            <Text style={styles.profileRole}>{typeName}</Text>
            {summary?.kycStatus === 'verified' ? <Text style={styles.kyc}>· KYC ✓</Text> : summary?.kycStatus === 'rejected' ? <Text style={styles.kycRej}>· KYC ✗</Text> : <Text style={styles.kycPend}>· KYC ⏳</Text>}
          </View>
        </View>
      )}
      accountMenu={{
        profile: profile || { fullName: summary?.name || user.fullName || user.username, userTypeName: typeName, userCode: summary?.userCode || user.username },
        balance: summary?.balance,
        onRefresh: () => api.retailer.summary().then(setSummary),
        walletAction: { label: 'Fund Request', onPress: () => go('/fund-request', 'Fund Request') },
        onManage: () => go('/profile', 'My Profile'),
        onLogout: doLogout,
        items: [
          { key: 'profile', label: 'My Profile', icon: 'user', onPress: () => go('/profile', 'My Profile') },
          { key: 'password', label: 'Change Password', icon: 'lock', onPress: () => go('/account-settings', 'Change Password') },
          { key: 'pin', label: 'Transaction PIN', icon: 'key', onPress: () => go('/txn-pin', 'Transaction PIN') },
          { key: 'kyc', label: 'KYC', icon: 'shield', onPress: () => go('/kyc', 'KYC') },
          { key: 'slab', label: 'My Commission Slab', icon: 'commission', onPress: () => go('/my-commission-slab', 'My Commission Slab') },
        ],
      }}
      title={modern && active.route === '/' ? null : <ScreenTitle panel="retailer" text={active.title} />}
    >
      {renderContent()}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: 'center', paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.sidebarBorder },
  profileBanner: { height: 72, alignSelf: 'stretch', backgroundColor: colors.primary, boxShadow: `inset 0 -30px 40px ${colors.primaryDark}` },
  avatarLg: { width: 86, height: 86, borderRadius: 43, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: -46, borderWidth: 4, borderColor: '#fff', ...shadows.card },
  profileName: { fontWeight: '800', color: colors.text, marginTop: 10, fontSize: 15.5 },
  roleRow: { flexDirection: 'row', gap: 4, marginTop: 2 },
  profileRole: { color: colors.muted, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.6 },
  kyc: { color: colors.success, fontSize: 11.5, fontWeight: '700' },
  kycPend: { color: colors.warning, fontSize: 11.5, fontWeight: '700' },
  kycRej: { color: colors.danger, fontSize: 11.5, fontWeight: '700' },
});
