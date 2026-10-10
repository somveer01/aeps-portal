import { toast } from '../components/Toast';

// Decides the confirmation (or error) message the user sees after any save / create / update / delete / transaction.
// request() in client.js calls notify() for every non-GET call, so every screen gets it for free:
//   created  ->  "Banner created successfully"      updated -> "Plan updated successfully"     deleted -> "City deleted successfully"
//   a money transaction -> "Mobile recharge of ₹199.00 to 98xxxxxx01 was successful" (or "is being processed" when still pending)
//   a failed call -> the server's reason ("Insufficient wallet balance", ...) as a red message.
// A call can pass { silent: true } to stay quiet or { message: '...' } to word its own success text.

// Calls that are not a "save": sign-in steps, look-ups and the status refresh a screen already explains inline.
const QUIET = [/^\/api\/auth\//, /^\/api\/account\/logout/, /^\/api\/settings\/logo-colors/, /^\/api\/bbps\/fetch-bill/, /^\/api\/dmt\/sender/, /^\/api\/verify\//, /^\/api\/uploads\//];

// First path segment (after /api/) -> what the thing is called in a sentence.
const ENTITY = {
  banners: 'Banner', announcements: 'Announcement', 'ticket-departments': 'Ticket department', 'service-categories': 'Service category',
  'user-types': 'User type', services: 'Service', plans: 'Plan', 'commission-slots': 'Commission slot', 'payout-banks': 'Payout bank',
  'company-banks': 'Company bank', cities: 'City', users: 'User', packages: 'Commission package', tickets: 'Ticket', 'fund-transfers': 'Fund transfer',
};

// Money transactions: path -> what it is called. The result is worded from the receipt the API returns.
const TXN = [
  [/^\/api\/recharge\/mobile/, 'Mobile recharge'], [/^\/api\/recharge\/dth/, 'DTH recharge'], [/^\/api\/bbps\/pay/, 'Bill payment'],
  [/^\/api\/lic\/pay/, 'LIC payment'], [/^\/api\/gas\/pay/, 'Gas booking payment'], [/^\/api\/fastag\/recharge/, 'FASTag recharge'],
  [/^\/api\/move-to-bank/, 'Move to bank'], [/^\/api\/aeps\/transact/, 'AEPS transaction'], [/^\/api\/aadhar-pay\/transact/, 'Aadhar Pay transaction'],
  [/^\/api\/micro-atm\/transact/, 'Micro ATM transaction'], [/^\/api\/dmt\/transfer/, 'Money transfer'], [/^\/api\/booking\//, 'Booking'],
];

const money = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? `₹${Number(v).toFixed(2)}` : '');
const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function entityOf(path) {
  const parts = path.replace(/^\/api\//, '').split('/');
  // /network/users, /network/packages ... use the segment after "network"; /my/... after "my"
  const seg = (parts[0] === 'network' || parts[0] === 'my') ? parts[1] : parts[0];
  return ENTITY[seg] || null;
}

// { type: 'success' | 'warning', text } for a call that worked, or null for "say nothing".
export function successMessage({ method, path, body, data }) {
  const b = body || {};
  if (QUIET.some((r) => r.test(path))) return null;

  // Money transactions
  for (const [re, name] of TXN) {
    if (!re.test(path)) continue;
    const r = (data && data.receipt) || data || {};
    const amt = money(r.amount != null ? r.amount : b.amount);
    const target = r.target || b.number || b.mobile || '';
    const what = `${name}${amt ? ` of ${amt}` : ''}${target ? ` to ${target}` : ''}`;
    if (r.status === 'pending') return { type: 'warning', text: `${what} is being processed. The final status will show in your reports.` };
    return { type: 'success', text: `${what} was successful.` };
  }

  // Named actions
  if (/\/settings\/(theme|app)$/.test(path)) return { type: 'success', text: 'Settings saved successfully.' };
  if (/\/settings\/login-banner$/.test(path) && method === 'DELETE') return { type: 'success', text: 'Login banner removed successfully.' };
  if (/\/account\/change-password$/.test(path)) return { type: 'success', text: 'Password changed successfully.' };
  if (/\/account\/profile$/.test(path)) return { type: 'success', text: 'Profile updated successfully.' };
  if (/\/account\/txn-pin$/.test(path)) return { type: 'success', text: 'Transaction PIN saved successfully.' };
  if (/\/service-permissions\//.test(path)) return { type: 'success', text: 'Service permissions saved successfully.' };
  if (/\/reset-password$/.test(path)) return { type: 'success', text: 'Password reset. Share the temporary password with the user; they must change it at the next login.' };
  if (/\/users\/\d+\/fund$/.test(path)) return { type: 'success', text: `${money(b.amount) || 'Amount'} ${b.type === 'debit' ? 'deducted from' : 'added to'} the user's wallet successfully.` };
  if (/\/admin-wallet\/add$/.test(path)) return { type: 'success', text: `${money(b.amount) || 'Amount'} added to your wallet successfully.` };
  if (/\/fund-transfers$/.test(path) && method === 'POST') return { type: 'success', text: `${money(b.amount) || 'Amount'} transferred successfully.` };
  if (/\/my\/fund-requests$/.test(path)) return { type: 'success', text: 'Fund request submitted successfully. You will be notified once it is processed.' };
  if (/\/fund-requests\/\d+$/.test(path)) return { type: 'success', text: b.status === 'rejected' ? 'Fund request rejected.' : 'Fund request approved successfully.' };
  if (/\/my\/kyc$/.test(path)) return { type: 'success', text: 'KYC submitted successfully. It will be reviewed shortly.' };
  if (/\/kyc-requests\/\d+$/.test(path)) return { type: 'success', text: b.status === 'rejected' ? 'KYC rejected.' : 'KYC approved successfully.' };
  if (/\/tickets\/\d+\/reply$/.test(path)) return { type: 'success', text: 'Reply sent successfully.' };
  if (/\/tickets\/\d+$/.test(path) && method === 'PUT') return { type: 'success', text: 'Ticket status updated successfully.' };
  if (/\/retailer\/tickets$/.test(path)) return { type: 'success', text: 'Ticket raised successfully. Our team will get back to you.' };
  if (/\/dmt\/beneficiary\/\d+\/verify$/.test(path)) return { type: 'success', text: 'Beneficiary verified successfully.' };
  if (/\/dmt\/beneficiary$/.test(path)) return { type: 'success', text: 'Beneficiary added successfully.' };
  if (/\/pending-transactions\/check$/.test(path) || /\/pending-transactions\/\d+\/check$/.test(path)) return { type: 'success', text: 'Status check completed.' };
  if (/\/pending-transactions\/\d+$/.test(path)) return { type: 'success', text: 'Transaction updated successfully.' };
  if (/\/reconciliation\/runs$/.test(path)) return { type: 'success', text: 'Reconciliation completed.' };
  if (/\/reconciliation\/items\/\d+$/.test(path)) return { type: 'success', text: 'Marked as resolved.' };
  if (/\/payout-banks\/\d+$/.test(path) && method === 'PUT' && b && Object.keys(b).length === 1 && 'status' in b) return { type: 'success', text: 'Status updated successfully.' };

  // Generic create / update / delete
  const ent = entityOf(path);
  const name = ent || 'Record';
  if (method === 'POST') return { type: 'success', text: `${name} created successfully.` };
  if (method === 'PUT' || method === 'PATCH') {
    const onlyStatus = b && Object.keys(b).length === 1 && ('isActive' in b || 'is_active' in b || 'status' in b);
    return { type: 'success', text: onlyStatus ? 'Status updated successfully.' : `${name} updated successfully.` };
  }
  if (method === 'DELETE') return { type: 'success', text: `${name} deleted successfully.` };
  return null;
}

// Text for a failed call, or null to stay quiet (sign-in screens and the forced password change show their own message).
export function failureMessage({ method, path, error }) {
  if (QUIET.some((r) => r.test(path))) return null;
  if (!error) return null;
  if (error.status === 401 || error.code === 'PASSWORD_CHANGE_REQUIRED') return null;
  if (error.code === 'NETWORK') return 'Cannot reach the server. Check your connection and try again.';
  const msg = String(error.message || '').trim();
  if (!msg || msg === 'Request failed') return method === 'DELETE' ? 'Could not delete. Please try again.' : 'Could not complete the request. Please try again.';
  return /[.!?]$/.test(msg) ? msg : `${msg}.`;
}

// Called by request() after every non-GET call.
export function notify({ method, path: rawPath, body, data, error, silent, message }) {
  if (silent) return;
  const path = String(rawPath || '').split('?')[0];
  try {
    if (error) {
      const text = failureMessage({ method, path, error });
      if (text) toast.error(text);
      return;
    }
    if (message) { toast.success(message); return; }
    const m = successMessage({ method, path, body, data });
    if (m) toast[m.type](m.text);
  } catch (e) { /* a message problem must never break the call */ }
}
