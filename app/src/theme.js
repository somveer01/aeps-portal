// Shared design tokens for the AEPS app (web + native).
// `colors` is a single mutable object. applyTheme() rewrites the themeable
// entries BEFORE screen StyleSheets are created (see App.js), so a saved
// primary/secondary flows through the whole app.

// Default theme ("Royal navy and gold"): used until the admin saves colours in Application Settings, and by "Reset theme to default".
export const DEFAULT_PRIMARY = '#1e3a8a';
export const DEFAULT_SECONDARY = '#b45309';

export const colors = {
  bg: '#eef1f6',
  surface: '#ffffff',
  surfaceAlt: '#f8fafc', // input / subtle fills
  sidebar: '#0f172a',
  sidebarFg: '#cbd5e1',
  sidebarActive: DEFAULT_SECONDARY, // menu highlight = secondary
  // Readable pairs, recomputed by applyTheme(): the active menu item uses the secondary colour unless that is too light
  // to show on the white sidebar (then the primary), and every "text on a coloured background" picks black or white.
  activeBg: DEFAULT_SECONDARY,
  onActive: '#ffffff',
  onPrimary: '#ffffff',
  primary: DEFAULT_PRIMARY,
  primaryDark: '#1a3379',
  primarySoft: '#eef1fa', // tinted primary wash (hover / active bg)
  secondary: DEFAULT_SECONDARY,
  navy: '#2b2f77',
  navyDark: '#20234f',
  loginBg: '#eef3fb',

  // Master layout (light sidebar + primary topbar + light-blue content)
  contentBg: '#f1f5fb',
  sidebarBg: '#ffffff',
  sidebarText: '#475569',
  sidebarBorder: '#eef2f7',
  topbarBg: DEFAULT_PRIMARY,
  topbarDark: '#1a3379',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e6ebf2',
  ring: 'rgba(30,58,138,0.14)', // focus ring (default-theme navy)
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  info: DEFAULT_PRIMARY,
  infoBg: '#eef1fa',
  success: '#16a34a',
  successBg: '#ecfdf5',
  warning: '#d97706',
  warningBg: '#fffbeb',
};

// Cross-platform elevation presets (web boxShadow + native shadow props).
export const shadows = {
  sm: { boxShadow: '0 1px 2px rgba(15,23,42,0.06)', shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  card: { boxShadow: '0 2px 10px rgba(15,23,42,0.06)', shadowColor: '#0f172a', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pop: { boxShadow: '0 12px 32px rgba(15,23,42,0.14)', shadowColor: '#0f172a', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
};

/** Validate a #rrggbb / #rgb hex color. */
export function isHex(c) {
  return typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

/** Darken a hex color by amt (0..1). */
export function darken(hex, amt = 0.12) {
  if (!isHex(hex)) return hex;
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amt)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - amt)));
  const b = Math.max(0, Math.round((n & 255) * (1 - amt)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Relative luminance 0 (black) .. 1 (white) of a hex colour. */
export function luminance(hex) {
  if (!isHex(hex)) return 0;
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Text colour that stays readable on a background of this colour: white on dark / mid colours, near-black on light ones. */
export function onColor(hex) {
  return luminance(hex) > 0.4 ? '#0f172a' : '#ffffff';
}

/**
 * Apply a theme by mutating the shared colors object. Call this at startup
 * (before screens render) and after the admin saves a new theme (followed by
 * a reload so already-created StyleSheets pick up the change).
 */
export function applyTheme({ primary, secondary } = {}) {
  const p = isHex(primary) ? primary : colors.primary;
  const s = isHex(secondary) ? secondary : colors.secondary;
  colors.primary = p;
  colors.primaryDark = darken(p, 0.12);
  colors.topbarBg = p;
  colors.topbarDark = darken(p, 0.12);
  colors.info = p;
  colors.secondary = s;
  colors.sidebarActive = s; // menu highlight
  colors.onPrimary = onColor(p);
  // A white / very light secondary would vanish on the white sidebar (white active item, white text): fall back to the primary.
  colors.activeBg = luminance(s) > 0.8 ? p : s;
  colors.onActive = onColor(colors.activeBg);
  return { primary: p, secondary: s };
}

export const radius = { sm: 8, md: 12, lg: 16 };
export const space = (n) => n * 4;
