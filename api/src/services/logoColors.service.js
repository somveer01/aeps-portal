'use strict';

const sharp = require('sharp');

// Picks theme colours from an uploaded logo: the most prominent distinct, saturated colours (greys, white, black and
// transparent pixels are ignored, so a logo on a white background still yields its brand colours).
// Returns { primary, secondary, palette } (hex strings), or { primary: null, secondary: null, palette: [] } when the
// logo has no real colour (e.g. black on white).

const SIZE = 96; // the logo is shrunk to at most 96 x 96 before counting pixels
const MIN_SATURATION = 0.2;
const MIN_VALUE = 0.15;
const DISTINCT = 70; // RGB distance for two colours to count as different
const SECONDARY_DISTINCT = 100;
const MIN_SHARE = 0.1; // a colour must cover at least 10% as much as the main one to be offered

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

function luminance({ r, g, b }) {
  const ch = [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const scale = (c, f) => ({ r: c.r * f, g: c.g * f, b: c.b * f });

async function paletteFromFile(file) {
  const { data, info } = await sharp(file, { failOn: 'none' })
    .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const buckets = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2]; const a = data[i + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const v = max / 255; const s = max ? (max - min) / max : 0;
    if (v < MIN_VALUE || s < MIN_SATURATION) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0 };
    e.n += 1; e.r += r; e.g += g; e.b += b; e.s += s;
    buckets.set(key, e);
  }

  const items = [...buckets.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, w: e.n * (0.6 + e.s / e.n) }))
    .sort((x, y) => y.w - x.w);

  // Merge near-identical shades: walk by weight, keep a colour only when it differs enough from those already kept.
  const palette = [];
  for (const it of items) {
    const near = palette.find((p) => dist(p, it) < DISTINCT);
    if (near) near.w += it.w; else palette.push({ ...it });
    if (palette.length >= 8) break;
  }
  palette.sort((x, y) => y.w - x.w);
  if (!palette.length) return { primary: null, secondary: null, palette: [] };
  // Drop the faint leftovers (anti-aliased edges between two colours) so only real brand colours are offered.
  const real = palette.filter((p) => p.w >= palette[0].w * MIN_SHARE);
  palette.length = 0; palette.push(...real);

  let primary = palette[0];
  if (luminance(primary) > 0.6) primary = { ...scale(primary, 0.7), w: primary.w }; // a very light brand colour is darkened to stay usable
  const second = palette.slice(1).find((p) => dist(p, primary) > SECONDARY_DISTINCT && p.w >= palette[0].w * 0.12);
  const secondary = second || { ...scale(primary, 0.8) }; // single-colour logo: a darker shade of it

  return { primary: hex(primary.r, primary.g, primary.b), secondary: hex(secondary.r, secondary.g, secondary.b), palette: palette.slice(0, 6).map((p) => hex(p.r, p.g, p.b)) };
}

module.exports = { paletteFromFile };
