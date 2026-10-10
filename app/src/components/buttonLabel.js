// Button captions are never shown in ALL CAPS: "+ NEW REQUEST" -> "+ New Request", "ALL KYC REQUESTS" -> "All KYC Requests".
// Only a caption with no lowercase letter at all is touched (a mixed-case caption is left exactly as written); known acronyms stay upper case.
const ACRONYMS = {
  KYC: 'KYC', EKYC: 'eKYC', IFSC: 'IFSC', OTP: 'OTP', PIN: 'PIN', AEPS: 'AEPS', DMT: 'DMT', UPI: 'UPI', GST: 'GST', GSTIN: 'GSTIN', TDS: 'TDS',
  PAN: 'PAN', DTH: 'DTH', SMS: 'SMS', ATM: 'ATM', ID: 'ID', API: 'API', CMS: 'CMS', LIC: 'LIC', NSDL: 'NSDL', QR: 'QR', PDF: 'PDF', CSV: 'CSV',
  XLS: 'XLS', IMPS: 'IMPS', NEFT: 'NEFT', RTGS: 'RTGS', BBPS: 'BBPS', FASTAG: 'FASTag', OK: 'OK', AC: 'AC',
};
const SMALL = new Set(['AND', 'OR', 'TO', 'OF', 'IN', 'FOR', 'A', 'AN', 'THE', 'ON', 'AT', 'BY']);

export default function buttonLabel(title) {
  if (typeof title !== 'string' || !/[A-Z]/.test(title) || /[a-z]/.test(title)) return title;
  let first = true;
  return title.replace(/[A-Z][A-Z0-9']*/g, (w) => {
    const isFirst = first; first = false;
    if (ACRONYMS[w]) return ACRONYMS[w];
    if (!isFirst && SMALL.has(w)) return w.toLowerCase();
    return w.charAt(0) + w.slice(1).toLowerCase();
  });
}
