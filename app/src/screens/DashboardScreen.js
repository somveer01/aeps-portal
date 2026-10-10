import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
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
import KycRequestScreen from './KycRequestScreen';
import PendingTransactionsScreen from './PendingTransactionsScreen';
import ReconciliationScreen from './ReconciliationScreen';
import AdminWalletAddScreen from './AdminWalletAddScreen';
import AdminWalletListScreen from './AdminWalletListScreen';
import ChangePasswordScreen from './ChangePasswordScreen';
import TxnPinScreen from './TxnPinScreen';
import RetailerPanelScreen from './RetailerPanelScreen';
import SupportTicketScreen from './SupportTicketScreen';
import ServicePermissionScreen from './ServicePermissionScreen';
import ProfileScreen from './ProfileScreen';
import ModernDashboard from './ModernDashboard';
import AppShell, { ScreenTitle } from '../shell/AppShell';
import useShellCore from '../shell/useShellCore';
import { api } from '../api/client';
import { colors, radius, shadows, ui } from '../theme';

// Title of the top-level module (group) that owns a given route, else null.
function moduleOf(nodes, route) {
  const has = (n) => n.route === route || (n.children || []).some(has);
  for (const top of nodes || []) {
    if (top.route === route) return null; // the route is itself a top-level item
    if ((top.children || []).some(has)) return top.title;
  }
  return null;
}

// The admin panel: the shell (sidebar, header, account menu, Classic / Modern layout) is the shared AppShell; this file only
// knows the admin routes -> screens, the admin wallet and the dashboard.
export default function DashboardScreen({ user, onLogout }) {
  const core = useShellCore({ expandAll: true });
  const { active, profile, setProfile } = core;
  const [announcements, setAnnouncements] = useState([]);
  const [balance, setBalance] = useState(null);
  const [dash, setDash] = useState(null);

  useEffect(() => {
    // Active announcements shown as a banner on the dashboard.
    api.announcements.active().then((r) => setAnnouncements(r.rows || [])).catch(() => {});
    api.adminWallet.balance().then((r) => setBalance(r.balance)).catch(() => {});
    api.adminDashboard().then(setDash).catch(() => {});
  }, []);

  const refreshBalance = () => api.adminWallet.balance().then((r) => setBalance(r.balance)).catch(() => {});
  // Revoke the token server-side (best-effort), then clear the local session.
  const doLogout = () => { api.account.logout().catch(() => {}).finally(() => onLogout()); };
  const selForm = (item) => {
    if (item.route === '/logout') { doLogout(); return; }
    core.open(item);
    refreshBalance(); // a wallet screen (Add Fund) may have changed it
  };
  const money = (v) => (v === null || v === undefined ? '₹0.00' : `₹${Number(v).toFixed(2)}`);
  const modern = ui.layout === 'modern';
  const name = profile?.fullName || user.fullName || user.username;

  const renderContent = () => (
  active.route === '/modules/settings' ? (
              <SettingsScreen />
            ) : active.route === '/modules/service-category' ? (
              <ServiceCategoryScreen />
            ) : active.route === '/modules/city-master' ? (
              <CityMasterScreen />
            ) : active.route === '/modules/user-type-master' ? (
              <UserTypeMasterScreen />
            ) : active.route === '/modules/service-master' ? (
              <ServiceMasterScreen />
            ) : active.route === '/modules/service-permissions' ? (
              <ServicePermissionScreen />
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
            ) : active.route === '/commission-report' ? (
              <TaxReportScreen kind="commission" key="commission" />
            ) : active.route === '/pending-transactions' ? (
              <PendingTransactionsScreen />
            ) : active.route === '/reconciliation' ? (
              <ReconciliationScreen />
            ) : active.route === '/kyc-requests' ? (
              <KycRequestScreen />
            ) : active.route === '/admin-margin' ? (
              <AdminMarginScreen />
            ) : active.route === '/admin-wallet/add' ? (
              <AdminWalletAddScreen />
            ) : active.route === '/admin-wallet/all' ? (
              <AdminWalletListScreen />
            ) : active.route === '/profile' ? (
              <ProfileScreen onChanged={setProfile} onLogout={onLogout}
                goTo={(route) => selForm({ title: route === '/change-password' ? 'Change Password' : route === '/txn-pin' ? 'Transaction PIN' : 'Wallet Transactions', route })}
                routes={{ password: '/change-password', pin: '/txn-pin', statement: '/admin-wallet/all' }} statementLabel="Wallet transactions" />
            ) : active.route === '/change-password' ? (
              <ChangePasswordScreen onDone={onLogout} />
            ) : active.route === '/txn-pin' ? (
              <TxnPinScreen />
            ) : active.route === '/retailer-panel' ? (
              <RetailerPanelScreen />
            ) : active.route === '/support-tickets' ? (
              <SupportTicketScreen />
            ) : active.route === '/' && modern ? (
              <ModernDashboard notice={<NoticeBanner items={announcements} />} onOpen={selForm} />
            ) : active.route === '/' ? (
              <>
                <NoticeBanner items={announcements} />
                <View style={styles.cards}>
                  <Stat label="Today's Commission" value={money(dash?.commission.today)} tone="success" />
                  <Stat label="Today's Transactions" value={String(dash?.transactions.today.count ?? 0)} sub={money(dash?.transactions.today.amount)} />
                  <Stat label="This Month Commission" value={money(dash?.commission.month)} tone="success" />
                  <Stat label="Total Users" value={String(dash?.users.total ?? 0)} sub={`${dash?.users.active ?? 0} active · ${dash?.users.inactive ?? 0} inactive`} />
                  <Stat label="Pending KYC" value={String(dash?.users.pendingKyc ?? 0)} tone="warning" />
                  <Stat label="Pending Fund Requests" value={String(dash?.fundRequests.pending ?? 0)} sub={money(dash?.fundRequests.amount)} tone="warning" />
                  <Stat label="Admin Wallet" value={money(dash?.adminWallet)} />
                  <Stat label="Users' Wallet Balance" value={money(dash?.users.walletTotal)} />
                  <Stat label="Active Services" value={`${dash?.services.active ?? 0} / ${dash?.services.total ?? 0}`} />
                  <Stat label="Total Transactions" value={String(dash?.transactions.total.count ?? 0)} sub={money(dash?.transactions.total.amount)} />
                </View>
  
                <View style={styles.dashRow}>
                  <Card style={styles.dashCardSm}>
                    <Text style={styles.cardTitle}>Users by Type</Text>
                    {(dash?.users.byType || []).map((t) => (
                      <View key={t.name} style={styles.rowLine}>
                        <Text style={styles.rowKey}>{t.name}</Text>
                        <Text style={styles.rowVal}>{t.count}</Text>
                      </View>
                    ))}
                    {(!dash || dash.users.byType.length === 0) ? <Text style={styles.para}>No users yet.</Text> : null}
                  </Card>
  
                  <Card style={styles.dashCardLg}>
                    <Text style={styles.cardTitle}>Recent Transactions</Text>
                    {(dash?.recent || []).map((r) => (
                      <View key={r.id} style={styles.rowLine}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowKey}>{r.service}</Text>
                          <Text style={styles.rowSub}>{r.user_name} · {r.user_code}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.rowVal}>{money(r.amount)}</Text>
                          <Text style={styles.rowSub}>{new Date(r.created_at).toLocaleDateString()}</Text>
                        </View>
                      </View>
                    ))}
                    {(!dash || dash.recent.length === 0) ? <Text style={styles.para}>No transactions yet.</Text> : null}
                  </Card>
                </View>
  
                <Card style={{ marginTop: 16 }}>
                  <Text style={styles.cardTitle}>Last 7 Days — Transaction Volume</Text>
                  <View style={styles.chart}>
                    {(dash?.trend7 || []).map((d) => {
                      const max = Math.max(1, ...(dash.trend7.map((x) => x.amount)));
                      const h = Math.round((d.amount / max) * 120) + 2;
                      return (
                        <View key={d.date} style={styles.chartCol}>
                          <Text style={styles.chartVal} numberOfLines={1}>{d.amount ? money(d.amount) : ''}</Text>
                          <View style={[styles.bar, { height: h }]} />
                          <Text style={styles.chartLbl}>{new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}</Text>
                          <Text style={styles.chartSub}>{d.count}</Text>
                        </View>
                      );
                    })}
                    {!dash ? <Text style={styles.para}>Loading…</Text> : null}
                  </View>
                </Card>
  
                <View style={styles.dashRow}>
                  <Card style={styles.dashCardLg}>
                    <Text style={styles.cardTitle}>Service-wise Earnings</Text>
                    {(dash?.byService || []).map((s) => (
                      <View key={s.service} style={styles.rowLine}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowKey}>{s.service}</Text>
                          <Text style={styles.rowSub}>{s.cnt} txns · {money(s.amt)}</Text>
                        </View>
                        <Text style={styles.rowVal}>{money(s.commission)}</Text>
                      </View>
                    ))}
                    {(!dash || dash.byService.length === 0) ? <Text style={styles.para}>No data yet.</Text> : null}
                  </Card>
  
                  <Card style={styles.dashCardSm}>
                    <Text style={styles.cardTitle}>Action Items</Text>
                    <ActionRow label="Fund Requests" count={dash?.actions.fundRequests} onPress={() => selForm({ title: 'Fund Requests', route: '/fund-requests' })} />
                    <ActionRow label="KYC Requests" count={dash?.actions.kyc} onPress={() => selForm({ title: 'KYC Requests', route: '/kyc-requests' })} />
                    <ActionRow label="Pending Transactions" count={dash?.actions.pendingTxns} onPress={() => selForm({ title: 'Pending Transactions', route: '/pending-transactions' })} />
                    <ActionRow label="Support Tickets" count={dash?.actions.tickets} onPress={() => selForm({ title: 'Support Tickets', route: '/support-tickets' })} />
                  </Card>
                </View>
              </>
            ) : (
              <Card>
                <Text style={styles.cardTitle}>{active.title}</Text>
                <Text style={styles.para}>
                  Placeholder screen for <Text style={{ fontWeight: '700' }}>{active.title}</Text>
                  {' '}(<Text style={styles.code}>{active.route}</Text>). To be built in a later phase.
                </Text>
              </Card>
            )
  );

  return (
    <AppShell
      panel="admin"
      core={core}
      onSelect={selForm}
      header={{
        name, photo: profile?.photo, role: 'Admin', brandText: 'AEPS Portal', balanceText: money(balance),
        onWallet: () => selForm({ title: 'Wallet Transactions', route: '/admin-wallet/all' }),
        onSettings: () => selForm({ title: 'Application Settings', route: '/modules/settings' }),
        onUser: () => { core.setUserMenu(true); refreshBalance(); },
      }}
      profileBlock={(
        <View style={styles.profile}>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user.fullName || user.username}</Text>
            <Text style={styles.profileRole}>{user.role}</Text>
          </View>
        </View>
      )}
      accountMenu={{
        profile: profile || { fullName: user.fullName || user.username, role: user.role, userCode: user.username },
        balance,
        onRefresh: () => api.adminWallet.balance().then((r) => setBalance(r.balance)),
        walletAction: { label: 'Add Fund', onPress: () => selForm({ title: 'Add Fund', route: '/admin-wallet/add' }) },
        onManage: () => selForm({ title: 'My Profile', route: '/profile' }),
        onLogout: doLogout,
        items: [
          { key: 'profile', label: 'My Profile', icon: 'user', onPress: () => selForm({ title: 'My Profile', route: '/profile' }) },
          { key: 'password', label: 'Change Password', icon: 'lock', onPress: () => selForm({ title: 'Change Password', route: '/change-password' }) },
          { key: 'pin', label: 'Transaction PIN', icon: 'key', onPress: () => selForm({ title: 'Transaction PIN', route: '/txn-pin' }) },
          { key: 'settings', label: 'Application Settings', icon: 'settings', onPress: () => selForm({ title: 'Application Settings', route: '/modules/settings' }) },
          { key: 'banners', label: 'Application Banners', icon: 'image', onPress: () => selForm({ title: 'Application Banners', route: '/modules/application-banners' }) },
        ],
      }}
      title={modern && active.route === '/' ? null : <ScreenTitle panel="admin" text={active.title} module={moduleOf(core.menu, active.route)} />}
    >
      {renderContent()}
    </AppShell>
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

function ActionRow({ label, count, onPress }) {
  const n = count ?? 0;
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      style={[styles.actionRow, hover && { backgroundColor: colors.primarySoft }]}>
      <Text style={styles.actionLabel}>{label}</Text>
      <View style={[styles.actionBadge, n > 0 ? styles.actionBadgeOn : styles.actionBadgeOff]}>
        <Text style={[styles.actionBadgeText, n === 0 && { color: colors.muted }]}>{n}</Text>
      </View>
      <Text style={styles.actionChevron}>›</Text>
    </Pressable>
  );
}

function Stat({ label, value, sub, tone }) {
  const toneColor = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.text;
  const topColor = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.primary;
  return (
    <Card style={[styles.stat, { borderTopColor: topColor }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: toneColor }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({


  profile: { borderBottomWidth: 1, borderBottomColor: colors.sidebarBorder },
  profileInfo: { alignItems: 'center', paddingTop: 12, paddingBottom: 14, paddingHorizontal: 14 },
  profileName: { fontWeight: '800', color: colors.text, fontSize: 15 },
  profileRole: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 1 },






  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#bfdbfe', borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 18, ...shadows.sm },
  noticeIcon: { fontSize: 18 },
  noticeText: { flex: 1, color: colors.primaryDark, fontWeight: '600' },
  noticeCount: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  stat: { flexGrow: 1, minWidth: 200, gap: 6, borderTopWidth: 3, borderTopColor: colors.primary },
  statLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  statSub: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  dashRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 16 },
  dashCardSm: { flexGrow: 1, flexBasis: 280, gap: 2 },
  dashCardLg: { flexGrow: 2, flexBasis: 380, gap: 2 },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.sidebarBorder },
  rowKey: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowVal: { color: colors.text, fontSize: 14, fontWeight: '800' },
  rowSub: { color: colors.muted, fontSize: 11.5, marginTop: 1 },

  // 7-day bar chart
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 14, minHeight: 170, paddingTop: 8 },
  chartCol: { flex: 1, alignItems: 'center', gap: 4 },
  chartVal: { color: colors.muted, fontSize: 9.5, fontWeight: '700', height: 12 },
  bar: { width: '70%', maxWidth: 46, backgroundColor: colors.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  chartLbl: { color: colors.text, fontSize: 11.5, fontWeight: '700', marginTop: 2 },
  chartSub: { color: colors.muted, fontSize: 10 },

  // Action items
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8, marginHorizontal: -8 },
  actionLabel: { flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '600' },
  actionBadge: { minWidth: 26, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionBadgeOn: { backgroundColor: colors.danger },
  actionBadgeOff: { backgroundColor: colors.sidebarBorder },
  actionBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
  actionChevron: { color: colors.muted, fontSize: 18, fontWeight: '700' },
  cardTitle: { fontSize: 17, fontWeight: '800', marginBottom: 10, color: colors.text },
  para: { color: colors.text, lineHeight: 21 },
  code: { fontFamily: 'monospace', backgroundColor: '#eef1f6', color: colors.text },
});
