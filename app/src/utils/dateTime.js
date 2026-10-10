// One place for how dates are written on screen, so every list, report and card shows the same thing.
//   fmtDateTime("2026-09-13T13:13:00Z") -> "13 Sep 2026 06:43 pm"   (every timestamp: created, updated, approved, ...)
//   fmtDate(...)                         -> "13 Sep 2026"            (only for values that really are a date with no time, e.g. a bank deposit date)
// Both show the time in the viewer's local time zone and return "—" for an empty or invalid value.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value) {
  const d = toDate(value);
  return d ? `${two(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
}

export function fmtDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  const h = d.getHours();
  return `${two(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${two(h % 12 || 12)}:${two(d.getMinutes())} ${h >= 12 ? 'pm' : 'am'}`;
}
