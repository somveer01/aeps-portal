import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Card, Button, TextField, Alert } from '../components/UI';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import { api } from '../api/client';
import { pickImage } from '../api/imagePicker';
import { colors, radius } from '../theme';

// My Profile (admin and managed users): edit name / email / photo; mobile, user id, type and KYC are read-only here.
// goTo(route) opens another screen of the current panel; routes = { password, pin, statement } and statementLabel are per panel.
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function ProfileScreen({ onChanged, goTo, routes = {}, statementLabel = 'Wallet statement', onLogout }) {
  const [p, setP] = useState(null);
  const [f, setF] = useState({ firstName: '', middleName: '', lastName: '', email: '' });
  const [curPwd, setCurPwd] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const apply = useCallback((profile) => {
    setP(profile);
    setF({ firstName: profile.firstName, middleName: profile.middleName, lastName: profile.lastName, email: profile.email });
    setCurPwd('');
    if (onChanged) onChanged(profile);
  }, [onChanged]);

  useEffect(() => {
    api.account.profile().then((r) => apply(r.profile)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [apply]);

  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (!p) return <Alert type="error">{error || 'Could not load your profile.'}</Alert>;

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const nameLocked = p.role !== 'admin' && p.kycStatus === 'verified';
  const emailChanged = f.email.trim() !== (p.email || '');
  const nameChanged = [['firstName'], ['middleName'], ['lastName']].some(([k]) => f[k].trim() !== (p[k] || ''));
  const dirty = emailChanged || (nameChanged && !nameLocked);

  const save = async () => {
    setError(null); setOk(null);
    const body = {};
    if (nameChanged && !nameLocked) {
      if (!f.firstName.trim()) { setError('First name is required.'); return; }
      if (!f.lastName.trim()) { setError('Last name is required.'); return; }
      Object.assign(body, { firstName: f.firstName, middleName: f.middleName, lastName: f.lastName });
    }
    if (emailChanged) {
      if (!curPwd) { setError('Enter your current password to change the email.'); return; }
      Object.assign(body, { email: f.email, currentPassword: curPwd });
    }
    setSaving(true);
    try { const r = await api.account.updateProfile(body); apply(r.profile); setOk('Profile updated.'); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const changePhoto = async () => {
    setError(null); setOk(null);
    try {
      const picked = await pickImage();
      if (!picked) return;
      setPhotoBusy(true);
      const { path } = await api.uploadImage(picked);
      const r = await api.account.updateProfile({ photo: path });
      apply(r.profile); setOk('Photo updated.');
    } catch (e) { setError(e.message); } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    setError(null); setOk(null); setPhotoBusy(true);
    try { const r = await api.account.updateProfile({ photo: '' }); apply(r.profile); setOk('Photo removed.'); }
    catch (e) { setError(e.message); } finally { setPhotoBusy(false); }
  };
  const signOutEverywhere = () => { api.account.logout().catch(() => {}).finally(() => onLogout && onLogout()); };

  const ro = [
    ['User ID', p.userCode], ['Account type', p.userTypeName], ['Mobile', p.mobile || '—'],
    ...(p.shopName ? [['Shop name', p.shopName]] : []), ...(p.parentCode ? [['Parent', p.parentCode]] : []),
    ...(p.kycStatus ? [['KYC', p.kycStatus]] : []),
  ];

  return (
    <View style={styles.wrap}>
      {error ? <Alert type="error">{error}</Alert> : null}
      {ok ? <Alert type="success">{ok}</Alert> : null}

      <Card style={styles.hero}>
        <Avatar photo={p.photo} name={p.fullName} size={92} border />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.heroName}>{p.fullName}</Text>
          <Text style={styles.heroSub}>{p.userTypeName} · {p.userCode}</Text>
          <View style={styles.photoBtns}>
            <Pressable onPress={changePhoto} disabled={photoBusy} style={({ hovered }) => [styles.pill, hovered && { backgroundColor: '#f1f5f9' }]}>
              <Icon name="camera" size={15} color={colors.primary} /><Text style={styles.pillText}>{photoBusy ? 'Please wait…' : p.photo ? 'Change photo' : 'Add photo'}</Text>
            </Pressable>
            {p.photo ? <Pressable onPress={removePhoto} disabled={photoBusy} style={({ hovered }) => [styles.pill, hovered && { backgroundColor: '#f1f5f9' }]}><Text style={[styles.pillText, { color: colors.danger }]}>Remove</Text></Pressable> : null}
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.section}>Personal info</Text>
        <View style={styles.grid}>
          <TextField style={styles.col} label="First name *" value={f.firstName} onChangeText={(v) => set('firstName', v)} maxLength={80} editable={!nameLocked} />
          <TextField style={styles.col} label="Middle name" value={f.middleName} onChangeText={(v) => set('middleName', v)} maxLength={80} placeholder={nameLocked ? '' : 'Optional'} editable={!nameLocked} />
          <TextField style={styles.col} label="Last name *" value={f.lastName} onChangeText={(v) => set('lastName', v)} maxLength={80} editable={!nameLocked} />
          <TextField style={styles.col} label="Email" value={f.email} onChangeText={(v) => set('email', v)} placeholder="you@example.com" keyboardType="email-address" maxLength={150} />
        </View>
        {nameLocked ? <Text style={styles.hint}>Your name is verified by KYC, so only the admin can change it.</Text> : null}
        {emailChanged ? (
          <View style={{ marginTop: 10, maxWidth: 360 }}>
            <TextField label="Current password (to change the email)" value={curPwd} onChangeText={setCurPwd} secureTextEntry placeholder="Your login password" />
          </View>
        ) : null}
        <View style={{ marginTop: 14, flexDirection: 'row' }}>
          <Button title="Save changes" onPress={save} loading={saving} disabled={!dirty} style={{ minWidth: 150 }} />
        </View>
      </Card>

      <Card>
        <Text style={styles.section}>Account details</Text>
        <View style={styles.grid}>
          {ro.map(([k, v]) => (
            <View key={k} style={styles.col}><Text style={styles.roLabel}>{k}</Text><Text style={[styles.roValue, k === 'KYC' && { textTransform: 'capitalize' }]}>{v}</Text></View>
          ))}
        </View>
        <Text style={styles.hint}>Mobile number, account type and KYC details cannot be changed here. Contact the admin if they need an update.</Text>
      </Card>

      <Card>
        <Text style={styles.section}>Wallet</Text>
        <View style={styles.rowBetween}>
          <View><Text style={styles.roLabel}>Balance</Text><Text style={styles.balance}>{money(p.balance)}</Text></View>
          {routes.statement && goTo ? <Button title={statementLabel} variant="ghost" onPress={() => goTo(routes.statement)} /> : null}
        </View>
      </Card>

      <Card>
        <Text style={styles.section}>Security</Text>
        <Text style={styles.roLabel}>Last sign-in</Text>
        <Text style={[styles.roValue, { marginBottom: 12 }]}>{fmt(p.lastLoginAt)}</Text>
        <View style={styles.secRow}>
          {routes.password && goTo ? <Pressable onPress={() => goTo(routes.password)} style={styles.secBtn}><Icon name="lock" size={16} color={colors.primary} /><Text style={styles.secText}>Change password</Text></Pressable> : null}
          {routes.pin && goTo ? <Pressable onPress={() => goTo(routes.pin)} style={styles.secBtn}><Icon name="key" size={16} color={colors.primary} /><Text style={styles.secText}>{p.hasTxnPin ? 'Change transaction PIN' : 'Set transaction PIN'}</Text></Pressable> : null}
          <Pressable onPress={signOutEverywhere} style={[styles.secBtn, { borderColor: '#fecaca' }]}><Icon name="logout" size={16} color={colors.danger} /><Text style={[styles.secText, { color: colors.danger }]}>Sign out from all devices</Text></Pressable>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16, maxWidth: 860 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 20, padding: 20, flexWrap: 'wrap' },
  heroName: { fontSize: 22, fontWeight: '800', color: colors.text },
  heroSub: { color: colors.muted, fontSize: 13.5 },
  photoBtns: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 14 },
  pillText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  section: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  col: { flexGrow: 1, flexBasis: 220, minWidth: 200 },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  roLabel: { color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  roValue: { color: colors.text, fontSize: 14.5, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  balance: { fontSize: 26, fontWeight: '800', color: colors.primary },
  secRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  secBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
  secText: { color: colors.text, fontWeight: '700', fontSize: 13.5 },
});
