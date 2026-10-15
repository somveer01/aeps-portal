import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Icon from './Icon';
import Avatar from './Avatar';
import { TextField, Alert } from './UI';
import { colors, radius } from '../theme';

// Account popover under the avatar chip (every panel): ONLY the signed-in user's details and Sign out.
// There is no separate profile page. The admin (who is not in Users Manager) can fix their own name / email here
// when `onSaveProfile` is passed; everyone else's details are edited by the admin in Users Manager.
//   profile: { fullName, firstName, lastName, email, mobile, photo, userCode, role, userTypeName }
//   onSaveProfile(body) -> Promise<profile>   body: { firstName, lastName, email?, currentPassword? }
export default function AccountMenu({ visible, onClose, profile, onLogout, onSaveProfile }) {
  const { width } = useWindowDimensions();
  const p = profile || {};
  const cardW = Math.min(360, width - 24);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', currentPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (!visible) { setEditing(false); setError(null); } }, [visible]);
  const startEdit = () => {
    setF({ firstName: p.firstName || '', lastName: p.lastName || '', email: p.email || '', currentPassword: '' });
    setError(null); setEditing(true);
  };
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const emailChanged = f.email.trim() !== (p.email || '');
  const save = async () => {
    setError(null);
    if (!f.firstName.trim() || !f.lastName.trim()) { setError('First and last name are required.'); return; }
    if (emailChanged && !f.currentPassword) { setError('Enter your current password to change the email.'); return; }
    const body = { firstName: f.firstName.trim(), lastName: f.lastName.trim() };
    if (emailChanged) Object.assign(body, { email: f.email.trim(), currentPassword: f.currentPassword });
    setSaving(true);
    try { await onSaveProfile(body); setEditing(false); }
    catch (e) { setError(e.message || 'Could not save'); } finally { setSaving(false); }
  };
  const run = (fn) => () => { onClose(); if (fn) fn(); };

  const rows = [
    ['User ID', p.userCode || p.username],
    ['Account type', p.userTypeName || (p.role === 'admin' ? 'Admin' : p.role)],
    ['Mobile', p.mobile],
    ['Email', p.email],
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* The inner Pressable swallows taps so only the backdrop closes the popover. */}
        <Pressable style={[styles.card, { width: cardW }]} onPress={() => {}}>
          <ScrollView style={{ maxHeight: '100%' }} showsVerticalScrollIndicator={false}>
            <View style={styles.head}>
              <Avatar photo={p.photo} name={p.fullName} size={72} />
              <Text style={styles.name} numberOfLines={1}>{p.fullName || '—'}</Text>
              {rows[1][1] ? <View style={styles.rolePill}><Text style={styles.roleText}>{rows[1][1]}</Text></View> : null}
            </View>

            {editing ? (
              <View style={styles.form}>
                {error ? <Alert type="error">{error}</Alert> : null}
                <TextField label="First name *" value={f.firstName} onChangeText={(v) => set('firstName', v)} maxLength={80} />
                <TextField label="Last name *" value={f.lastName} onChangeText={(v) => set('lastName', v)} maxLength={80} />
                <TextField label="Email" value={f.email} onChangeText={(v) => set('email', v)} keyboardType="email-address" maxLength={150} />
                {emailChanged ? (
                  <TextField label="Current password (to change the email)" value={f.currentPassword} onChangeText={(v) => set('currentPassword', v)} secureTextEntry />
                ) : null}
                <View style={styles.formBtns}>
                  <Pressable onPress={() => setEditing(false)} style={({ hovered }) => [styles.btn, styles.btnGhost, hovered && { backgroundColor: '#f1f5f9' }]}>
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={saving ? undefined : save} style={[styles.btn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
                    <Text style={[styles.btnText, { color: colors.onPrimary }]}>{saving ? 'Saving…' : 'Save'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.details}>
                {rows.map(([k, v]) => (
                  <View key={k} style={styles.detailRow}>
                    <Text style={styles.detailKey}>{k}</Text>
                    <Text style={styles.detailVal} numberOfLines={1}>{v || '—'}</Text>
                  </View>
                ))}
                {onSaveProfile ? (
                  <Pressable onPress={startEdit} style={({ hovered }) => [styles.editLink, hovered && { backgroundColor: '#f1f5f9' }]}>
                    <Icon name="edit" size={15} color={colors.primary} /><Text style={styles.editText}>Edit name / email</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            <View style={styles.list}>
              <View style={styles.divider} />
              <Pressable onPress={run(onLogout)} style={({ hovered }) => [styles.row, hovered && { backgroundColor: '#fef2f2' }]}>
                <View style={[styles.rowIcon, { backgroundColor: '#fef2f2' }]}><Icon name="logout" size={17} color={colors.danger} /></View>
                <Text style={[styles.rowText, { color: colors.danger }]}>Sign out</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.18)' },
  card: {
    position: 'absolute', top: 54, right: 12, maxHeight: '88%', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border, shadowColor: '#0f172a', shadowOpacity: 0.22, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 10,
  },
  head: { alignItems: 'center', paddingTop: 22, paddingHorizontal: 20, paddingBottom: 12, gap: 4 },
  name: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 8, maxWidth: '100%' },
  rolePill: { backgroundColor: '#eef2ff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  roleText: { color: colors.primary, fontSize: 11.5, fontWeight: '700', textTransform: 'capitalize' },
  details: { marginHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  detailKey: { width: 96, color: colors.muted, fontSize: 12.5 },
  detailVal: { flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '600' },
  editLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginHorizontal: 6, marginVertical: 4, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  editText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  form: { marginHorizontal: 14, gap: 10 },
  formBtns: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 2 },
  btn: { minHeight: 40, paddingHorizontal: 18, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  btnGhostText: { color: colors.text, fontWeight: '700', fontSize: 13.5 },
  btnText: { fontWeight: '700', fontSize: 13.5 },
  list: { paddingVertical: 6, paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 14 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6, marginHorizontal: 6 },
});
