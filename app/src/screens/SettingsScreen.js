import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, Platform, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api, assetUrl } from '../api/client';
import { pickImage } from '../api/imagePicker';
import { setThemeCache } from '../api/storage';
import { colors, radius, isHex, applyTheme, DEFAULT_PRIMARY, DEFAULT_SECONDARY } from '../theme';

const PRESETS = ['#2563eb', '#1d4ed8', '#0ea5e9', '#0891b2', '#059669', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#0f172a', '#334155'];
const OTP_OPTIONS = [{ label: 'Activate', value: 'activate' }, { label: 'Deactivate', value: 'deactivate' }];

function ColorPicker({ label, value, onChange, logoColors }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={[styles.swatchLg, { backgroundColor: isHex(value) ? value : '#e2e8f0' }]} />
        <TextInput value={value} onChangeText={onChange} placeholder="#2563eb" autoCapitalize="none" placeholderTextColor={colors.muted} style={styles.hexInput} maxLength={7} />
      </View>
      {logoColors && logoColors.length ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.hint}>From your logo</Text>
          <View style={styles.swatchGrid}>
            {logoColors.map((c) => (
              <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c }, (value || '').toLowerCase() === c && styles.swatchSel]} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.swatchGrid}>
        {PRESETS.map((c) => (
          <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c }, (value || '').toLowerCase() === c && styles.swatchSel]} />
        ))}
      </View>
    </View>
  );
}

function ImageField({ label, value, onChange, uploading, onPick, tall }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.imageRow}>
        {value ? (
          <Image source={{ uri: assetUrl(value) }} style={[styles.imgPreview, tall && { height: 70 }]} resizeMode="contain" />
        ) : (
          <View style={[styles.imgPreview, styles.imgEmpty, tall && { height: 70 }]}><Text style={{ color: '#94a3b8', fontSize: 11 }}>none</Text></View>
        )}
        <View style={{ gap: 6 }}>
          <Button title={value ? 'Change' : 'Upload'} variant="ghost" onPress={onPick} loading={uploading} style={{ minWidth: 110 }} />
          {value ? <Pressable onPress={() => onChange('')}><Text style={{ color: colors.danger, fontWeight: '600', fontSize: 12 }}>Remove</Text></Pressable> : null}
        </View>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const [s, setS] = useState(null); // app settings object
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null); // which key is uploading
  const [bannerBusy, setBannerBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [logoPalette, setLogoPalette] = useState(null); // { primary, secondary, palette } picked from the logo (null = none asked yet)
  const [paletteBusy, setPaletteBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { settings } = await api.getAppSettings();
        if (!settings.theme_primary) settings.theme_primary = colors.primary;
        if (!settings.theme_secondary) settings.theme_secondary = colors.secondary;
        setS(settings);
        const pub = await api.publicSettings().catch(() => ({}));
        setBanner(assetUrl(pub.loginBanner));
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    })();
  }, []);

  const setField = (k, v) => setS((p) => ({ ...p, [k]: v }));

  const uploadFor = async (key) => {
    setError(null);
    try {
      const picked = await pickImage();
      if (!picked) return;
      setUploading(key);
      const { path } = await api.uploadImage(picked);
      setField(key, path);
      if (key === 'web_logo' || key === 'logo_icon') suggestColors(path); // a new logo: offer its colours (nothing is applied until you press Apply)
    } catch (e) { setError(e.message || 'Upload failed'); } finally { setUploading(null); }
  };

  // Ask the server for the brand colours of an uploaded logo; the admin then applies them (or not) and saves as usual.
  const suggestColors = async (path) => {
    setPaletteBusy(true);
    try { setLogoPalette(await api.logoColors(path)); }
    catch (e) { setLogoPalette(null); setError(e.message || 'Could not read colours from the logo'); } finally { setPaletteBusy(false); }
  };
  const logoPath = s ? (s.web_logo || s.logo_icon || s.mobile_logo || '') : '';
  const applySuggested = () => {
    if (!logoPalette || !logoPalette.primary) return;
    setField('theme_primary', logoPalette.primary); setField('theme_secondary', logoPalette.secondary);
    setInfo('Logo colours applied below. Press Save to keep them.');
  };

  const saveAll = async () => {
    setError(null); setInfo(null);
    if (s.theme_primary && !isHex(s.theme_primary)) { setError('Theme primary must be a valid hex color.'); return; }
    if (s.theme_secondary && !isHex(s.theme_secondary)) { setError('Theme secondary must be a valid hex color.'); return; }
    setSaving(true);
    try {
      await api.saveAppSettings(s);
      if (isHex(s.theme_primary) && isHex(s.theme_secondary)) {
        await setThemeCache({ primary: s.theme_primary, secondary: s.theme_secondary });
        applyTheme({ primary: s.theme_primary, secondary: s.theme_secondary });
      }
      setInfo('Application settings saved.');
      if (Platform.OS === 'web') setTimeout(() => window.location.reload(), 500);
    } catch (e) { setError(e.message || 'Could not save'); } finally { setSaving(false); }
  };

  const uploadBanner = async () => {
    setError(null); setInfo(null);
    try {
      const picked = await pickImage(); if (!picked) return;
      setBannerBusy(true);
      const { loginBanner } = await api.uploadLoginBanner(picked);
      setBanner(assetUrl(loginBanner)); setInfo('Login banner updated.');
    } catch (e) { setError(e.message || 'Upload failed'); } finally { setBannerBusy(false); }
  };
  const removeBanner = async () => {
    setBannerBusy(true);
    try { await api.clearLoginBanner(); setBanner(null); setInfo('Login banner removed.'); }
    catch (e) { setError(e.message); } finally { setBannerBusy(false); }
  };

  if (loading || !s) return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={{ gap: 16 }}>
      <Alert type="info">{info}</Alert>
      <Alert type="error">{error}</Alert>

      {/* General */}
      <Card>
        <Text style={styles.section}>General</Text>
        <View style={styles.grid}>
          <Field label="App Name *" value={s.app_name} onChange={(v) => setField('app_name', v)} placeholder="AEPS Portal" />
          <Field label="User Id Prefix *" value={s.user_id_prefix} onChange={(v) => setField('user_id_prefix', v)} placeholder="AEP" />
          <Field label="Support Contact No *" value={s.support_contact} onChange={(v) => setField('support_contact', v)} placeholder="+91 90000 00000" />
          <Field label="Support Email *" value={s.support_email} onChange={(v) => setField('support_email', v)} placeholder="support@aepsportal.in" />
        </View>
      </Card>

      {/* Branding */}
      <Card>
        <Text style={styles.section}>Branding & Logos</Text>
        <View style={styles.grid}>
          <ImageField label="Web Logo *" value={s.web_logo} onChange={(v) => setField('web_logo', v)} uploading={uploading === 'web_logo'} onPick={() => uploadFor('web_logo')} tall />
          <ImageField label="Mobile App Logo *" value={s.mobile_logo} onChange={(v) => setField('mobile_logo', v)} uploading={uploading === 'mobile_logo'} onPick={() => uploadFor('mobile_logo')} tall />
          <ImageField label="Logo Icon *" value={s.logo_icon} onChange={(v) => setField('logo_icon', v)} uploading={uploading === 'logo_icon'} onPick={() => uploadFor('logo_icon')} />
          <ImageField label="App Loader *" value={s.app_loader} onChange={(v) => setField('app_loader', v)} uploading={uploading === 'app_loader'} onPick={() => uploadFor('app_loader')} />
          <ImageField label="Favicon *" value={s.favicon} onChange={(v) => setField('favicon', v)} uploading={uploading === 'favicon'} onPick={() => uploadFor('favicon')} />
        </View>
      </Card>

      {/* Charges & OTP */}
      <Card>
        <Text style={styles.section}>Charges & OTP</Text>
        <View style={styles.grid}>
          <Field label="Onboarding Charge *" value={s.onboarding_charge} onChange={(v) => setField('onboarding_charge', v)} placeholder="10.00" keyboardType="numeric" />
          <Field label="Penny Drop Charge *" value={s.penny_drop_charge} onChange={(v) => setField('penny_drop_charge', v)} placeholder="1.00" keyboardType="numeric" />
          <View style={styles.field}><Select label="Enable SMS OTP *" value={s.enable_sms_otp || 'activate'} options={OTP_OPTIONS} onChange={(v) => setField('enable_sms_otp', v)} searchable={false} /></View>
          <View style={styles.field}><Select label="Enable Email OTP *" value={s.enable_email_otp || 'deactivate'} options={OTP_OPTIONS} onChange={(v) => setField('enable_email_otp', v)} searchable={false} /></View>
        </View>
      </Card>

      {/* Theme */}
      <Card>
        <Text style={styles.section}>Theme Colors</Text>

        {/* Colours from the logo: only when a logo is set; without one the colours below work as before */}
        {logoPath ? (
          <View style={styles.logoBox}>
            <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
              <Text style={styles.label}>Colours from your logo</Text>
              {paletteBusy ? <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start' }} /> : null}
              {!paletteBusy && logoPalette && logoPalette.primary ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <View style={styles.sugg}><View style={[styles.suggDot, { backgroundColor: logoPalette.primary }]} /><Text style={styles.suggText}>Primary {logoPalette.primary}</Text></View>
                  <View style={styles.sugg}><View style={[styles.suggDot, { backgroundColor: logoPalette.secondary }]} /><Text style={styles.suggText}>Secondary {logoPalette.secondary}</Text></View>
                </View>
              ) : null}
              {!paletteBusy && logoPalette && !logoPalette.primary ? <Text style={styles.hint}>This logo has no distinct colour (black / grey / white), so pick the colours yourself below.</Text> : null}
              {!paletteBusy && !logoPalette ? <Text style={styles.hint}>Pick the theme colours from your logo, then press Apply and Save.</Text> : null}
            </View>
            <View style={{ gap: 6 }}>
              {logoPalette && logoPalette.primary ? <Button title="Apply logo colours" onPress={applySuggested} style={{ minWidth: 170 }} /> : null}
              <Button title={logoPalette ? 'Pick again' : 'Pick colours from logo'} variant="ghost" onPress={() => suggestColors(logoPath)} loading={paletteBusy} style={{ minWidth: 170 }} />
            </View>
          </View>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.field}><ColorPicker label="Theme Primary Color *" value={s.theme_primary} onChange={(v) => setField('theme_primary', v)} logoColors={logoPalette && logoPalette.palette} /></View>
          <View style={styles.field}><ColorPicker label="Theme Secondary Color * (menu highlight)" value={s.theme_secondary} onChange={(v) => setField('theme_secondary', v)} logoColors={logoPalette && logoPalette.palette} /></View>
        </View>
        <Pressable onPress={() => { setField('theme_primary', DEFAULT_PRIMARY); setField('theme_secondary', DEFAULT_SECONDARY); }}><Text style={{ color: colors.primary, fontWeight: '600', marginTop: 8 }}>Reset theme to default</Text></Pressable>
      </Card>

      {/* Certificate */}
      <Card>
        <Text style={styles.section}>Certificate</Text>
        <View style={styles.grid}>
          <ImageField label="Certificate Signature *" value={s.cert_signature} onChange={(v) => setField('cert_signature', v)} uploading={uploading === 'cert_signature'} onPick={() => uploadFor('cert_signature')} />
          <Field label="Certificate Issuer Name *" value={s.cert_issuer_name} onChange={(v) => setField('cert_issuer_name', v)} placeholder="Issuer full name" />
          <Field label="Certificate Issuer Designation *" value={s.cert_issuer_designation} onChange={(v) => setField('cert_issuer_designation', v)} placeholder="Issuer designation" />
        </View>
        <View style={{ gap: 6, marginTop: 14 }}>
          <Text style={styles.label}>Certificate Terms & Conditions *</Text>
          <TextInput value={s.cert_terms} onChangeText={(v) => setField('cert_terms', v)} multiline placeholder="Terms & conditions…" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} />
        </View>
      </Card>

      {/* Content */}
      <Card>
        <Text style={styles.section}>Content Pages</Text>
        <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}><Text style={styles.label}>About Us *</Text>
            <TextInput value={s.about_us} onChangeText={(v) => setField('about_us', v)} multiline placeholder="About the company…" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} /></View>
          <View style={{ gap: 6 }}><Text style={styles.label}>Help *</Text>
            <TextInput value={s.help} onChangeText={(v) => setField('help', v)} multiline placeholder="Help / support text…" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} /></View>
          <View style={{ gap: 6 }}><Text style={styles.label}>Privacy Policy *</Text>
            <TextInput value={s.privacy_policy} onChangeText={(v) => setField('privacy_policy', v)} multiline placeholder="Privacy policy…" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} /></View>
        </View>
      </Card>

      {/* Login banner (login page cover) */}
      <Card>
        <Text style={styles.section}>Login Page Banner</Text>
        <Text style={styles.help}>Shown on the left of the login page. Recommended a tall image ~1200×1600px.</Text>
        {banner ? <Image source={{ uri: banner }} style={styles.bannerPreview} resizeMode="cover" />
          : <View style={[styles.bannerPreview, styles.imgEmpty]}><Text style={{ color: '#cbd5e1', fontWeight: '700' }}>Default banner (no image set)</Text></View>}
        <View style={styles.actions}>
          <Button title={banner ? 'Change banner' : 'Upload banner'} onPress={uploadBanner} loading={bannerBusy} style={{ flex: 1 }} />
          {banner ? <Button title="Remove" variant="ghost" onPress={removeBanner} disabled={bannerBusy} style={{ flex: 1 }} /> : null}
        </View>
      </Card>

      {/* Save */}
      <View style={styles.saveBar}>
        <Button title="SAVE SETTINGS" onPress={saveAll} loading={saving} style={{ minWidth: 200, paddingHorizontal: 24 }} />
      </View>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} keyboardType={keyboardType} autoCapitalize="none" style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
  help: { color: colors.muted, marginBottom: 10, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 16 },
  field: { flexGrow: 1, flexBasis: '30%', minWidth: 220, gap: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  imgPreview: { width: 120, height: 48, borderRadius: radius.sm, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border },
  imgEmpty: { alignItems: 'center', justifyContent: 'center' },
  hexInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, color: colors.text, outlineStyle: 'none' },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  logoBox: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginBottom: 16 },
  sugg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.border },
  suggText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  swatchLg: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  swatchSel: { borderColor: colors.text },
  bannerPreview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.sidebar, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  saveBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: 20 },
});
