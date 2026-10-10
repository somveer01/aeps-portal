'use strict';

const settingsRepo = require('../repositories/settings.repo');

const LOGIN_BANNER_KEY = 'login_banner';
const THEME_PRIMARY_KEY = 'theme_primary';
const THEME_SECONDARY_KEY = 'theme_secondary';
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const UPLOAD_PATH = /^\/uploads\/[\w.-]+$/;

// Whitelisted Application Settings keys with their types.
const APP_SETTINGS = {
  app_name: 'text',
  user_id_prefix: 'text',
  support_contact: 'text',
  support_email: 'text',
  web_logo: 'path',
  mobile_logo: 'path',
  logo_icon: 'path',
  app_loader: 'path',
  favicon: 'path',
  onboarding_charge: 'number',
  penny_drop_charge: 'number',
  enable_sms_otp: 'enum',
  enable_email_otp: 'enum',
  theme_primary: 'color',
  theme_secondary: 'color',
  cert_signature: 'path',
  cert_issuer_name: 'text',
  cert_issuer_designation: 'text',
  cert_terms: 'longtext',
  about_us: 'longtext',
  help: 'longtext',
  privacy_policy: 'longtext',
};
const ENUM_VALUES = ['activate', 'deactivate'];

// GET /api/settings/public  (no auth) -> values the app/login screen needs
async function getPublic(req, res, next) {
  try {
    const [loginBanner, themePrimary, themeSecondary, appName, supportContact, supportEmail, webLogo, mobileLogo, logoIcon, favicon] = await Promise.all([
      settingsRepo.get(LOGIN_BANNER_KEY), settingsRepo.get(THEME_PRIMARY_KEY), settingsRepo.get(THEME_SECONDARY_KEY),
      settingsRepo.get('app_name'), settingsRepo.get('support_contact'), settingsRepo.get('support_email'),
      settingsRepo.get('web_logo'), settingsRepo.get('mobile_logo'), settingsRepo.get('logo_icon'), settingsRepo.get('favicon'),
    ]);
    return res.json({
      loginBanner: loginBanner || null,
      theme: { primary: themePrimary || null, secondary: themeSecondary || null },
      app: {
        appName: appName || null, supportContact: supportContact || null, supportEmail: supportEmail || null,
        webLogo: webLogo || null, mobileLogo: mobileLogo || null, logoIcon: logoIcon || null, favicon: favicon || null,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/settings/app  (admin) -> all application settings
async function getApp(req, res, next) {
  try {
    const keys = Object.keys(APP_SETTINGS);
    const values = await Promise.all(keys.map((k) => settingsRepo.get(k)));
    const out = {};
    keys.forEach((k, i) => { out[k] = values[i] ?? ''; });
    return res.json({ settings: out });
  } catch (err) {
    return next(err);
  }
}

// POST /api/settings/app  (admin) -> save whitelisted keys
async function saveApp(req, res, next) {
  try {
    const body = req.body || {};
    const toSave = [];
    for (const [key, type] of Object.entries(APP_SETTINGS)) {
      if (body[key] === undefined) continue;
      let val = body[key];
      if (type === 'color') {
        val = String(val).trim();
        if (val && !HEX.test(val)) return res.status(400).json({ error: `${key} must be a valid hex color`, code: 'INVALID_COLOR' });
      } else if (type === 'number') {
        const n = Number(val);
        if (val !== '' && (Number.isNaN(n) || n < 0)) return res.status(400).json({ error: `${key} must be a non-negative number`, code: 'INVALID_NUMBER' });
        val = val === '' ? '' : String(n);
      } else if (type === 'enum') {
        val = String(val).toLowerCase().trim();
        if (val && !ENUM_VALUES.includes(val)) return res.status(400).json({ error: `${key} must be activate/deactivate`, code: 'INVALID_ENUM' });
      } else if (type === 'path') {
        val = String(val).trim();
        if (val && !UPLOAD_PATH.test(val)) val = ''; // ignore non-upload paths
      } else {
        val = String(val);
        const cap = type === 'longtext' ? 20000 : 255;
        if (val.length > cap) return res.status(400).json({ error: `${key} is too long`, code: 'TOO_LONG' });
      }
      toSave.push([key, val]);
    }
    for (const [k, v] of toSave) await settingsRepo.set(k, v);
    return res.json({ ok: true, saved: toSave.length });
  } catch (err) {
    return next(err);
  }
}

// POST /api/settings/theme  (admin)  { primary, secondary }
async function saveTheme(req, res, next) {
  try {
    const primary = String(req.body.primary || '').trim();
    const secondary = String(req.body.secondary || '').trim();
    if (!HEX.test(primary) || !HEX.test(secondary)) {
      return res.status(400).json({ error: 'Colors must be valid hex (e.g. #2563eb)', code: 'INVALID_COLOR' });
    }
    await settingsRepo.set(THEME_PRIMARY_KEY, primary);
    await settingsRepo.set(THEME_SECONDARY_KEY, secondary);
    return res.json({ theme: { primary, secondary } });
  } catch (err) {
    return next(err);
  }
}

// POST /api/settings/login-banner  (admin, multipart field "banner")
async function uploadLoginBanner(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const relPath = `/uploads/${req.file.filename}`;
    await settingsRepo.set(LOGIN_BANNER_KEY, relPath);
    return res.json({ loginBanner: relPath });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/settings/login-banner (admin) -> revert to default
async function clearLoginBanner(req, res, next) {
  try {
    await settingsRepo.set(LOGIN_BANNER_KEY, '');
    return res.json({ loginBanner: null });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getPublic, getApp, saveApp, saveTheme, uploadLoginBanner, clearLoginBanner };
