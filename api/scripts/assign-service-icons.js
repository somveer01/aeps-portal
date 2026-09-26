'use strict';

/**
 * Generates a clean, service-appropriate icon (colored rounded badge + white
 * glyph) for each service and stores it under /uploads, then sets services.icon.
 *
 * Idempotent: only fills services that have no icon. Pass --force to regenerate
 * all. Run:  node scripts/assign-service-icons.js  [--force]
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../src/config/db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 24x24 white-stroke glyphs.
const G = {
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  tv: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  fingerprint: '<path d="M12 4a8 8 0 0 1 8 8"/><path d="M4 12a8 8 0 0 1 4-6.9"/><path d="M7.5 20a12 12 0 0 0 1-8 3.5 3.5 0 0 1 7 0c0 1 .1 2 .3 3"/><path d="M12 12v3a9 9 0 0 1-.8 4"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  bank: '<path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3l9-5z"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h2"/>',
  walletPlus: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M15 10v4M13 12h4"/>',
  idcard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M14 10h5M14 13h5M5 16h6"/>',
  usercheck: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 12l2 2 4-4"/>',
  atm: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 22h10M8 8h8M8 12h5"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  car: '<path d="M5 16l1.6-5h10.8L19 16"/><path d="M3 16h18v3h-2v-1H5v1H3z"/><circle cx="7.5" cy="18.5" r="1.1"/><circle cx="16.5" cy="18.5" r="1.1"/>',
  services: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>',
};

// title keyword -> { glyph, color }. Order matters: most specific first, so
// "DTH Recharge"/"Fastag Recharge" don't fall into the generic recharge rule.
const MAP = [
  [/dth/i, { g: 'tv', c: '#7c3aed' }],
  [/fastag|toll/i, { g: 'car', c: '#db2777' }],
  [/lic|insurance/i, { g: 'shield', c: '#9333ea' }],
  [/\bpan\b/i, { g: 'idcard', c: '#b45309' }],
  [/aadhar|aadhaar/i, { g: 'idcard', c: '#dc2626' }],
  [/ekyc|kyc/i, { g: 'usercheck', c: '#4f46e5' }],
  [/aeps/i, { g: 'fingerprint', c: '#059669' }],
  [/money transfer|dmt/i, { g: 'send', c: '#ea580c' }],
  [/move to bank/i, { g: 'bank', c: '#0f766e' }],
  [/fund request/i, { g: 'wallet', c: '#ca8a04' }],
  [/load money/i, { g: 'walletPlus', c: '#16a34a' }],
  [/micro atm|atm/i, { g: 'atm', c: '#0284c7' }],
  [/bill|bbps/i, { g: 'receipt', c: '#0891b2' }],
  [/mobile/i, { g: 'phone', c: '#2563eb' }],
  [/recharge/i, { g: 'phone', c: '#2563eb' }],
];

function pick(title) {
  const hit = MAP.find(([re]) => re.test(title));
  return hit ? hit[1] : { g: 'services', c: '#2563eb' };
}

function svg(color, glyphKey) {
  const glyph = G[glyphKey] || G.services;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect x="4" y="4" width="88" height="88" rx="20" fill="${color}"/>
    <g transform="translate(24,24) scale(2)" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
  </svg>`;
}

(async () => {
  const force = process.argv.includes('--force');
  const rows = await db('services').select('id', 'title', 'icon');
  let n = 0;
  for (const row of rows) {
    if (row.icon && !force) continue;
    const { g, c } = pick(row.title);
    const png = await sharp(Buffer.from(svg(c, g))).png().toBuffer();
    const filename = `service-${row.id}.png`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), png);
    await db('services').where({ id: row.id }).update({ icon: `/uploads/${filename}`, updated_at: db.fn.now() });
    n += 1;
    // eslint-disable-next-line no-console
    console.log(`  ${row.title} -> ${g} (${c})`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nAssigned icons to ${n} service(s).`);
  await db.destroy();
})().catch((e) => { console.error(e); process.exit(1); });
