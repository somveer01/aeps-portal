import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, Platform, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Card, Button, Alert, Select } from '../components/UI';
import { api, assetUrl } from '../api/client';
import { pickImage } from '../api/imagePicker';
import { setThemeCache } from '../api/storage';
import { colors, radius, isHex, applyTheme, resolveTheme, DEFAULT_PRIMARY, DEFAULT_SECONDARY } from '../theme';

const PRESETS = [DEFAULT_PRIMARY, DEFAULT_SECONDARY, '#2563eb', '#1d4ed8', '#0ea5e9', '#0891b2', '#059669', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#0f172a', '#334155'];
const OTP_OPTIONS = [{ label: 'Activate', value: 'activate' }, { label: 'Deactivate', value: 'deactivate' }];

// Any colour: a spectrum grid (12 hues x 5 lightness steps + greys) on every platform, and on the web the browser's full colour
// dialog (click the big box: any colour, plus an eyedropper in Chrome / Edge). Hex typing, presets and logo colours still work.
const hslToHex = (h, s, l) => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
const SPECTRUM = [30, 40, 50, 62, 75].map((l) => Array.from({ length: 12 }, (_, i) => hslToHex(i * 30, 78, l)));
const GREYS = ['#000000', '#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#ffffff'];
const sixHex = (v) => { // <input type="color"> needs #rrggbb
  if (!isHex(v)) return '#000000';
  const h = v.trim().toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
};

function ColorPicker({ label, value, onChange, logoColors }) {
  const [more, setMore] = useState(false);
  const isSel = (c) => (value || '').toLowerCase() === c;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={[styles.swatchLg, { backgroundColor: isHex(value) ? value : '#e2e8f0' }]}>
          {Platform.OS === 'web' ? React.createElement('input', {
            type: 'color', value: sixHex(value), title: 'Choose any colour', 'aria-label': `${label}: choose any colour`,
            onChange: (e) => onChange(String(e.target.value).toLowerCase()),
            style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, padding: 0 },
          }) : null}
        </View>
        <TextInput value={value} onChangeText={onChange} placeholder="#1e3a8a" autoCapitalize="none" placeholderTextColor={colors.muted} style={styles.hexInput} maxLength={7} />
      </View>
      {Platform.OS === 'web' ? <Text style={styles.hint}>Click the colour box to choose any colour.</Text> : null}
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
          <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c }, isSel(c) && styles.swatchSel]} />
        ))}
      </View>
      <Pressable onPress={() => setMore((m) => !m)} hitSlop={6}>
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12.5 }}>{more ? 'Hide all colours ▴' : 'More colours ▾'}</Text>
      </Pressable>
      {more ? (
        <View style={{ gap: 6 }}>
          {SPECTRUM.map((row, i) => (
            <View key={i} style={styles.swatchGrid}>
              {row.map((c) => <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c }, isSel(c) && styles.swatchSel]} />)}
            </View>
          ))}
          <View style={styles.swatchGrid}>
            {GREYS.map((c) => <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c, borderColor: isSel(c) ? colors.text : colors.border }]} />)}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// What the chosen colours will look like (same resolveTheme() the app uses): header, active menu item, button and a table header.
// Light colours (white, yellow ...) are handled automatically - the header keeps the exact colour with readable text,
// the rest uses a darker shade of it.
function ThemePreview({ primary, secondary }) {
  const p = isHex(primary) ? primary : DEFAULT_PRIMARY;
  const s = isHex(secondary) ? secondary : DEFAULT_SECONDARY;
  const t = resolveTheme(p, s);
  const glass = t.onBrand === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.1)';
  return (
    <View style={styles.pvWrap}>
      <Text style={styles.hint}>Preview</Text>
      <View style={styles.pvBox}>
        <View style={[styles.pvHeader, { backgroundColor: t.brand, borderBottomColor: t.brandBorder }]}>
          <Text style={{ color: t.onBrand, fontWeight: '800', fontSize: 13 }}>Header</Text>
          <View style={{ flex: 1 }} />
          <View style={[styles.pvPill, { backgroundColor: glass }]}><Text style={{ color: t.onBrand, fontWeight: '700', fontSize: 11 }}>Wallet ₹2000</Text></View>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <View style={styles.pvSide}>
            <View style={[styles.pvItem, { backgroundColor: t.activeBg }]}><Text style={{ color: t.onActive, fontWeight: '700', fontSize: 11 }}>Dashboard</Text></View>
            <View style={styles.pvItem}><View style={[styles.pvDot, { backgroundColor: t.primary }]} /><Text style={{ color: colors.sidebarText, fontSize: 11 }}>Users</Text></View>
          </View>
          <View style={{ flex: 1, padding: 8, gap: 6 }}>
            <View style={[styles.pvTh, { backgroundColor: t.primary }]}><Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 10 }}>NAME</Text></View>
            <View style={[styles.pvBtn, { backgroundColor: t.primary }]}><Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 11 }}>Save</Text></View>
          </View>
        </View>
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
        if (!settings.theme_primary) settings.theme_primary = colors.brand;
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
        <ThemePreview primary={s.theme_primary} secondary={s.theme_secondary} />
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
  pvWrap: { marginTop: 16, gap: 6, maxWidth: 420 },
  pvBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#f1f5fb' },
  pvHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 10, borderBottomWidth: 1 },
  pvPill: { borderRadius: 12, paddingVertical: 3, paddingHorizontal: 8 },
  pvSide: { width: 110, backgroundColor: '#fff', padding: 8, gap: 4 },
  pvItem: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
  pvDot: { width: 10, height: 10, borderRadius: 5 },
  pvTh: { borderRadius: 4, paddingVertical: 5, paddingHorizontal: 8 },
  pvBtn: { alignSelf: 'flex-start', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  logoBox: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginBottom: 16 },
  sugg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.border },
  suggText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  swatchLg: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', position: 'relative' },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  swatchSel: { borderColor: colors.text },
  bannerPreview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.sidebar, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  saveBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: 20 },
});
