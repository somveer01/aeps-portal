import { Platform } from 'react-native';
import { fmtDateTime } from './dateTime';

// Account statement download (web): CSV, and PDF through the browser's print dialog ("Save as PDF").
// Rows are wallet history rows from the API (`txn_id`, `type`, `amount`, `updated_balance`, `remark`, `service_name`, ...).
export const EXPORT_CAP = 5000; // rows in one download
const PER_PAGE = 100; // the API's page size limit

const num = (v) => Number(v || 0).toFixed(2);

// Every row of the current filter (newest first, column filters kept), page by page up to EXPORT_CAP.
export async function fetchAllRows(fetchPage, params) {
  const rows = []; let total = 0; let totals = null;
  for (let page = 1; rows.length < EXPORT_CAP; page += 1) {
    const res = await fetchPage({ ...params, page, pageSize: PER_PAGE });
    total = res.total; totals = res.totals || totals;
    rows.push(...res.rows);
    if (!res.rows.length || rows.length >= res.total) break;
  }
  return { rows: rows.slice(0, EXPORT_CAP), total, totals, truncated: total > EXPORT_CAP };
}

// One statement line: Date | Txn Id | Narration | Debit | Credit | Balance (+ who, for the admin).
export function statementLines(rows, { withUser = false } = {}) {
  return rows.map((r) => ({
    date: fmtDateTime(r.created_at), txnId: r.txn_id || '', service: r.service_name || '', narration: r.remark || r.service_name || '',
    debit: r.type === 'debit' ? num(r.amount) : '', credit: r.type === 'credit' ? num(r.amount) : '', balance: num(r.updated_balance),
    user: withUser ? `${r.user_code || ''} ${r.user_name || ''}`.trim() : '',
  }));
}

// A cell that starts with = + - @ would run as a formula in Excel, so it gets a leading quote.
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(lines, { withUser = false } = {}) {
  const head = ['Date', 'Txn Id', ...(withUser ? ['User'] : []), 'Service', 'Narration', 'Debit', 'Credit', 'Balance'];
  const body = lines.map((l) => [l.date, l.txnId, ...(withUser ? [l.user] : []), l.service, l.narration, l.debit, l.credit, l.balance]);
  return `﻿${[head, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const isWeb = () => Platform.OS === 'web' && typeof document !== 'undefined';
export const canDownload = isWeb;

export function saveCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The statement as a printable page. `win` is a window opened in the click itself (so the pop-up blocker lets it through).
export function printStatement(win, { title, subtitle, lines, totals, withUser = false }) {
  const rows = lines.map((l) => `<tr><td>${esc(l.date)}</td><td class="m">${esc(l.txnId)}</td>${withUser ? `<td>${esc(l.user)}</td>` : ''}
    <td>${esc(l.narration)}</td><td class="n d">${esc(l.debit)}</td><td class="n c">${esc(l.credit)}</td><td class="n">${esc(l.balance)}</td></tr>`).join('');
  const sum = totals ? `<p class="sum">Total debit: <b>₹${num(totals.debit)}</b> &nbsp; Total credit: <b>₹${num(totals.credit)}</b>${
    totals.opening !== undefined ? ` &nbsp; Opening balance: <b>₹${num(totals.opening)}</b> &nbsp; Closing balance: <b>₹${num(totals.closing)}</b>` : ''}</p>` : '';
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12px}h1{font-size:18px;margin:0 0 4px}.sub{color:#555;margin:0 0 10px}
    .sum{margin:8px 0 12px}table{width:100%;border-collapse:collapse}th{background:#e8ecf3;text-align:left;padding:6px;border:1px solid #cfd6e2;font-size:11px;text-transform:uppercase}
    td{padding:6px;border:1px solid #dde3ee;vertical-align:top}.n{text-align:right;white-space:nowrap}.m{font-family:monospace;white-space:nowrap}.d{color:#b91c1c}.c{color:#15803d}
    tr{page-break-inside:avoid}@page{size:A4 landscape;margin:12mm}</style></head><body>
    <h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>${sum}
    <table><thead><tr><th>Date</th><th>Txn Id</th>${withUser ? '<th>User</th>' : ''}<th>Narration</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
  win.document.close();
}

export function openPrintWindow() { return isWeb() ? window.open('', '_blank') : null; }
