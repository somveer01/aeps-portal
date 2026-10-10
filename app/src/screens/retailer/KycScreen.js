import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, Image, Pressable, Platform } from 'react-native';
import { Card, Button, Alert, StatusBadge } from '../../components/UI';
import { api, assetUrl } from '../../api/client';
import { pickImage } from '../../api/imagePicker';
import { colors, radius } from '../../theme';
import { fmtDateTime as dt } from '../../utils/dateTime';

// Photos the user must provide; bank proof is optional.
export const KYC_DOCS = [
  { key: 'aadhaarFront', field: 'aadhaar_front', label: 'Aadhaar card (front)' },
  { key: 'aadhaarBack', field: 'aadhaar_back', label: 'Aadhaar card (back)' },
  { key: 'panCard', field: 'pan_card', label: 'PAN card' },
  { key: 'shopPhoto', field: 'shop_photo', label: 'Shop photo (outside, with name board)' },
  { key: 'selfie', field: 'selfie', label: 'Selfie (clear face)' },
  { key: 'bankProof', field: 'bank_proof', label: 'Cancelled cheque or passbook (optional)', optional: true },
];
const EMPTY = { aadhaarNumber: '', panNumber: '', bankName: '', accountHolder: '', accountNo: '', ifscCode: '' };
const localPreview = (picked) => {
  if (picked && picked.asset) return picked.asset.uri;
  if (picked && picked.file && Platform.OS === 'web') return URL.createObjectURL(picked.file);
  return null;
};

// Retailer / distributor / MD: upload KYC documents and see the admin's decision.
export default function KycScreen({ onDone }) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api.kyc.mine()); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  if (error) return <Alert type="error">{error}</Alert>;

  const sub = data.submission;
  if (data.kycStatus === 'verified') {
    return (
      <View style={{ gap: 16 }}>
        <Alert type="success">Your KYC is verified. All services you have access to are open.</Alert>
        {sub ? <Summary sub={sub} /> : null}
      </View>
    );
  }
  if (sub && sub.status === 'pending') {
    return (
      <View style={{ gap: 16 }}>
        {notice ? <Alert type="success">{notice}</Alert> : null}
        <Alert type="info">Your documents are under review. Services unlock once the admin approves them. You do not need to upload again.</Alert>
        <Summary sub={sub} />
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      {sub && sub.status === 'rejected' ? (
        <Alert type="error">{`Your KYC was not approved: ${sub.review_remark || 'no reason given'}. Fix this and submit again.`}</Alert>
      ) : (
        <Alert type="info">Upload your documents to verify your account. Services stay locked until the admin approves your KYC.</Alert>
      )}
      <KycForm onSubmitted={async () => { setNotice('Documents submitted. We will let you know once they are reviewed.'); await load(); if (onDone) onDone(); }} />
    </View>
  );
}

function Summary({ sub }) {
  return (
    <Card>
      <View style={styles.sumHead}>
        <Text style={styles.cardTitle}>Submitted on {dt(sub.created_at)}</Text>
        <StatusBadge label={sub.status} tone={sub.status === 'approved' ? 'success' : sub.status === 'rejected' ? 'danger' : 'warning'} />
      </View>
      <View style={styles.kv}>
        {[['Aadhaar', `XXXX XXXX ${sub.aadhaar_last4}`], ['PAN', sub.pan_number], ['Bank', sub.bank_name], ['Account holder', sub.account_holder],
          ['Account no.', sub.account_no], ['IFSC', sub.ifsc_code]].map(([k, v]) => (
          <View key={k} style={styles.kvRow}><Text style={styles.kvKey}>{k}</Text><Text style={styles.kvVal}>{v}</Text></View>
        ))}
      </View>
      <View style={styles.thumbs}>
        {KYC_DOCS.filter((d) => sub.files[d.field]).map((d) => (
          <View key={d.key} style={styles.thumbBox}>
            <Image source={{ uri: assetUrl(sub.files[d.field]) }} style={styles.thumb} resizeMode="cover" />
            <Text style={styles.thumbLabel} numberOfLines={2}>{d.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function KycForm({ onSubmitted }) {
  const [f, setF] = useState(EMPTY);
  const [docs, setDocs] = useState({}); // key -> { name, preview }
  const [busy, setBusy] = useState(null); const [saving, setSaving] = useState(false); const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const choose = async (key) => {
    setError(null);
    try {
      const picked = await pickImage();
      if (!picked) return;
      setBusy(key);
      const { name } = await api.kyc.upload(picked);
      setDocs((d) => ({ ...d, [key]: { name, preview: localPreview(picked) } }));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const submit = async () => {
    setError(null);
    const aadhaar = f.aadhaarNumber.replace(/\s/g, '');
    if (!/^\d{12}$/.test(aadhaar)) return setError('Enter your 12-digit Aadhaar number.');
    if (!/^[2-9]/.test(aadhaar)) return setError('Aadhaar number cannot start with 0 or 1. Please check the number.');
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(f.panNumber)) return setError('Enter a valid PAN, like ABCDE1234F.');
    if (!f.bankName.trim() || !f.accountHolder.trim()) return setError('Enter the bank name and account holder name.');
    if (!/^\d{6,20}$/.test(f.accountNo)) return setError('Enter a valid account number.');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifscCode)) return setError('Enter a valid IFSC, like SBIN0001234.');
    const missing = KYC_DOCS.filter((d) => !d.optional && !docs[d.key]);
    if (missing.length) return setError(`Upload: ${missing.map((d) => d.label).join(', ')}.`);
    setSaving(true);
    try {
      const body = { ...f };
      KYC_DOCS.forEach((d) => { body[d.key] = docs[d.key] ? docs[d.key].name : ''; });
      await api.kyc.submit(body);
      await onSubmitted();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Card>
      {error ? <Alert type="error">{error}</Alert> : null}
      <Text style={styles.section}>Identity</Text>
      <View style={styles.grid}>
        <Field label="Aadhaar Number *" value={f.aadhaarNumber} onChange={(v) => set('aadhaarNumber', v.replace(/[^\d ]/g, '').slice(0, 14))} placeholder="12-digit Aadhaar" keyboardType="numeric" />
        <Field label="PAN Number *" value={f.panNumber} onChange={(v) => set('panNumber', v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="ABCDE1234F" />
      </View>
      <Text style={styles.hint}>Only the last 4 digits of your Aadhaar number are saved.</Text>

      <Text style={styles.section}>Bank account (for settlement)</Text>
      <View style={styles.grid}>
        <Field label="Bank Name *" value={f.bankName} onChange={(v) => set('bankName', v)} placeholder="e.g. State Bank of India" />
        <Field label="Account Holder *" value={f.accountHolder} onChange={(v) => set('accountHolder', v)} placeholder="Name as in bank" />
        <Field label="Account Number *" value={f.accountNo} onChange={(v) => set('accountNo', v.replace(/\D/g, '').slice(0, 20))} placeholder="Account number" keyboardType="numeric" />
        <Field label="IFSC *" value={f.ifscCode} onChange={(v) => set('ifscCode', v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} placeholder="SBIN0001234" />
      </View>

      <Text style={styles.section}>Documents</Text>
      <Text style={styles.hint}>Clear photos, all corners visible, 5 MB or smaller (png, jpg or webp).</Text>
      <View style={styles.docs}>
        {KYC_DOCS.map((d) => (
          <View key={d.key} style={styles.docSlot}>
            {docs[d.key] && docs[d.key].preview
              ? <Image source={{ uri: docs[d.key].preview }} style={styles.docThumb} resizeMode="cover" />
              : <View style={[styles.docThumb, styles.docEmpty]}><Text style={{ color: docs[d.key] ? colors.success : colors.muted, fontSize: 12 }}>{docs[d.key] ? 'Uploaded' : 'No photo'}</Text></View>}
            <Text style={styles.docLabel}>{d.label}</Text>
            <Pressable onPress={() => choose(d.key)} disabled={!!busy} style={styles.docBtn}>
              <Text style={styles.docBtnText}>{busy === d.key ? 'Uploading…' : docs[d.key] ? 'Change' : 'Upload'}</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 18, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Button title="Submit for Verification" onPress={submit} loading={saving} disabled={!!busy} style={{ minWidth: 220 }} />
      </View>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} keyboardType={keyboardType} autoCapitalize="characters" style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 10 },
  hint: { color: colors.muted, fontSize: 12.5, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  field: { flexGrow: 1, flexBasis: '40%', minWidth: 220, gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569' },
  input: { minHeight: 48, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  docs: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  docSlot: { width: 170, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 },
  docThumb: { width: '100%', height: 100, borderRadius: radius.sm, backgroundColor: '#f1f5f9' },
  docEmpty: { alignItems: 'center', justifyContent: 'center' },
  docLabel: { fontSize: 12.5, color: colors.text, fontWeight: '600', minHeight: 32 },
  docBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 6, alignItems: 'center' },
  docBtnText: { color: colors.primary, fontWeight: '700', fontSize: 12.5 },
  sumHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  kv: { marginTop: 12, gap: 6 },
  kvRow: { flexDirection: 'row', gap: 10 },
  kvKey: { width: 130, color: colors.muted, fontSize: 13 },
  kvVal: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 13 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  thumbBox: { width: 130, gap: 6 },
  thumb: { width: 130, height: 90, borderRadius: radius.sm, backgroundColor: '#f1f5f9' },
  thumbLabel: { fontSize: 11.5, color: colors.muted },
});
