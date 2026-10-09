// Thin API client for the AEPS backend. Resolves the base URL so it works
// on web (localhost) and on a physical phone via Expo Go (dev machine LAN IP).
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getToken } from './storage';

const API_PORT = 3000;

function resolveBaseUrl() {
  // Allow an explicit override via app config (extra.apiUrl, from EXPO_PUBLIC_API_URL
  // at build time). A defined override — INCLUDING an empty string — wins: '' means
  // "same origin" so the web build calls a relative `/api` that nginx proxies to the API.
  const override = Constants.expoConfig?.extra?.apiUrl;
  if (override !== undefined && override !== null) return override;

  if (Platform.OS === 'web') return `http://localhost:${API_PORT}`;

  // Native: derive the dev machine's LAN IP from Expo's host string.
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoClient?.hostUri ||
    '';
  const host = hostUri.split(':')[0];
  return host ? `http://${host}:${API_PORT}` : `http://localhost:${API_PORT}`;
}

export const BASE_URL = resolveBaseUrl();

// Build a query string from an object, skipping empty values.
function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// Unique key for idempotent money requests (prevents double-charge on retry).
export function idemKey() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request(path, { method = 'GET', body, auth = false, idempotencyKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Cannot reach server. Is the API running?', 0, 'NETWORK');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Request failed', res.status, data.code, data);
  return data;
}

export class ApiError extends Error {
  constructor(message, status, code, data = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data; // the whole error body (e.g. the users listed with DOWNLINE_TYPE_MISMATCH)
  }
}

// Turn a stored path like "/uploads/x.png" into a full URL for <Image>.
export function assetUrl(pathOrNull) {
  if (!pathOrNull) return null;
  if (/^https?:\/\//i.test(pathOrNull)) return pathOrNull;
  return `${BASE_URL}${pathOrNull}`;
}

// Build a multipart FormData from a picked image under the given field name.
// Accepts { file } (a real web File — most reliable on web) or { asset }
// (an expo-image-picker asset on native).
async function buildImageForm(picked, field) {
  const form = new FormData();
  if (picked && picked.file) {
    form.append(field, picked.file, picked.file.name || `${field}.png`);
  } else if (picked && picked.asset) {
    const a = picked.asset;
    if (Platform.OS === 'web') {
      const blob = await (await fetch(a.uri)).blob();
      form.append(field, blob, a.fileName || `${field}.${(blob.type.split('/')[1] || 'png')}`);
    } else {
      const type = a.mimeType || 'image/jpeg';
      form.append(field, { uri: a.uri, name: a.fileName || `${field}.${type.split('/')[1] || 'jpg'}`, type });
    }
  } else {
    throw new ApiError('No image selected', 0, 'NO_FILE');
  }
  return form;
}

async function postForm(path, form) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Upload failed', res.status, data.code);
  return data;
}

// Login banner upload -> { loginBanner }
async function uploadLoginBanner(picked) {
  return postForm('/api/settings/login-banner', await buildImageForm(picked, 'banner'));
}

// Generic image upload -> { path } (e.g. service icons)
async function uploadImage(picked) {
  return postForm('/api/uploads/image', await buildImageForm(picked, 'image'));
}

// KYC document upload -> { name } (a private file; shown later through signed links)
async function uploadKycDocument(picked) {
  return postForm('/api/kyc/upload', await buildImageForm(picked, 'image'));
}

export const api = {
  health: () => request('/api/health'),
  getCaptcha: () => request('/api/auth/captcha'),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  verifyOtp: (payload) => request('/api/auth/verify-otp', { method: 'POST', body: payload }),
  resendOtp: (pendingToken) =>
    request('/api/auth/resend-otp', { method: 'POST', body: { pendingToken } }),
  me: () => request('/api/me', { auth: true }),
  menu: () => request('/api/menu', { auth: true }),
  publicSettings: () => request('/api/settings/public'),
  uploadLoginBanner,
  uploadImage,
  clearLoginBanner: () => request('/api/settings/login-banner', { method: 'DELETE', auth: true }),
  saveTheme: (primary, secondary) => request('/api/settings/theme', { method: 'POST', body: { primary, secondary }, auth: true }),
  getAppSettings: () => request('/api/settings/app', { auth: true }),
  saveAppSettings: (settings) => request('/api/settings/app', { method: 'POST', body: settings, auth: true }),

  // Modules → Application Banners
  banners: {
    list: (params = {}) => request(`/api/banners?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/banners', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/banners/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/banners/${id}`, { method: 'DELETE', auth: true }),
  },

  // Modules → Announcements
  announcements: {
    list: (params = {}) => request(`/api/announcements?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    active: (userTypeId = '') => request(`/api/announcements/active?userTypeId=${userTypeId}`, { auth: true }),
    create: (body) => request('/api/announcements', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/announcements/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/announcements/${id}`, { method: 'DELETE', auth: true }),
  },

  // Support Tickets (admin: all tickets)
  tickets: {
    list: (params = {}) => request(`/api/tickets?${qs(params)}`, { auth: true }),
    get: (id) => request(`/api/tickets/${id}`, { auth: true }),
    updateStatus: (id, status) => request(`/api/tickets/${id}`, { method: 'PUT', body: { status }, auth: true }),
    reply: (id, message) => request(`/api/tickets/${id}/reply`, { method: 'POST', body: { message }, auth: true }),
  },

  // Modules → Ticket Departments
  ticketDepartments: {
    list: (params = {}) => request(`/api/ticket-departments?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/ticket-departments', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/ticket-departments/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/ticket-departments/${id}`, { method: 'DELETE', auth: true }),
  },

  // Modules → Service Categories
  serviceCategories: {
    list: (params = {}) => request(`/api/service-categories?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/service-categories', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/service-categories/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/service-categories/${id}`, { method: 'DELETE', auth: true }),
  },

  // Modules → User Type Master
  userTypes: {
    list: (params = {}) => request(`/api/user-types?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/user-types', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/user-types/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/user-types/${id}`, { method: 'DELETE', auth: true }),
  },

  // Modules → Service Master
  services: {
    list: ({ q = '', page = 1, pageSize = 10, active = false, categoryId = '', withCounts = false } = {}) =>
      request(`/api/services?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}${active ? '&active=1' : ''}${categoryId ? `&categoryId=${categoryId}` : ''}${withCounts ? '&withCounts=1' : ''}`, { auth: true }),
    create: (body) => request('/api/services', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/services/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/services/${id}`, { method: 'DELETE', auth: true }),
  },

  // Modules → Service Permissions (user-type defaults + per-user allow/block, service-wise)
  servicePermissions: {
    matrix: () => request('/api/service-permissions/matrix', { auth: true }),
    setMatrix: (body) => request('/api/service-permissions/matrix', { method: 'PUT', body, auth: true }),
    users: (serviceId, params = {}) => request(`/api/service-permissions/services/${serviceId}/users?${qs(params)}`, { auth: true }),
    setUsers: (serviceId, body) => request(`/api/service-permissions/services/${serviceId}/users`, { method: 'PUT', body, auth: true }),
  },

  // Modules → Plan Master
  plans: {
    list: (params = {}) => request(`/api/plans?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/plans', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/plans/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/plans/${id}`, { method: 'DELETE', auth: true }),
  },

  // Modules → Commission Slots
  commissionSlots: {
    list: (params = {}) => request(`/api/commission-slots?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/commission-slots', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/commission-slots/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/commission-slots/${id}`, { method: 'DELETE', auth: true }),
    operatorOptions: (serviceId) => request(`/api/commission-slots/operator-options?serviceId=${serviceId}`, { auth: true }),
    chainGaps: () => request('/api/commission-slots/chain-gaps', { auth: true }),
  },

  // Banks master (for Company Bank dropdown)
  banks: () => request('/api/banks', { auth: true }),
  moduleOptions: () => request('/api/module-options', { auth: true }),

  // Payout Banks (admin approve/reject user payout accounts)
  payoutBanks: {
    list: (params = {}) => request(`/api/payout-banks?${qs(params)}`, { auth: true }),
    create: (body) => request('/api/payout-banks', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/payout-banks/${id}`, { method: 'PUT', body, auth: true }),
    act: (id, body) => request(`/api/payout-banks/${id}`, { method: 'PUT', body, auth: true }),
  },

  // Fund Transfer (admin -> user wallet) + history
  fundTransfer: {
    lookup: (code) => request(`/api/fund-transfer/lookup?code=${encodeURIComponent(code)}`, { auth: true }),
    list: (params = {}) => request(`/api/fund-transfers?${qs(params)}`, { auth: true }),
    create: (body) => request('/api/fund-transfers', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },

  // Reports + Fund Requests
  reports: {
    accountHistory: (params = {}) => request(`/api/account-history?${qs(params)}`, { auth: true }),
    serviceReport: (params = {}) => request(`/api/service-report?${qs(params)}`, { auth: true }),
    fundRequests: (params = {}) => request(`/api/fund-requests?${qs(params)}`, { auth: true }),
    actFundRequest: (id, body) => request(`/api/fund-requests/${id}`, { method: 'PUT', body, auth: true, idempotencyKey: idemKey() }),
    gstReport: (params = {}) => request(`/api/gst-report?${qs(params)}`, { auth: true }),
    tdsReport: (params = {}) => request(`/api/tds-report?${qs(params)}`, { auth: true }),
    commissionReport: (params = {}) => request(`/api/commission-report?${qs(params)}`, { auth: true }),
    adminMargin: (params = {}) => request(`/api/admin-margin-report?${qs(params)}`, { auth: true }),
  },

  // Commission Slab (read-only view of commission slots)
  commissionSlab: (params = {}) => request(`/api/commission-slab?${qs(params)}`, { auth: true }),

  // Aadhaar & PAN verification (sandbox KYC)
  verify: {
    pan: (panNumber) => request('/api/verify/pan', { method: 'POST', body: { panNumber }, auth: true }),
    aadhaar: (aadhaarNumber, transactionPassword) =>
      request('/api/verify/aadhaar', { method: 'POST', body: { aadhaarNumber, transactionPassword }, auth: true }),
  },

  // Admin Wallet (top up / adjust admin wallet + history)
  adminDashboard: () => request('/api/admin/dashboard', { auth: true }),

  adminWallet: {
    balance: () => request('/api/admin-wallet/balance', { auth: true }),
    list: (params = {}) => request(`/api/admin-wallet?${qs(params)}`, { auth: true }),
    add: (body) => request('/api/admin-wallet/add', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },

  // Account settings → change password / logout (revoke) / transaction PIN
  account: {
    changePassword: (body) => request('/api/account/change-password', { method: 'POST', body, auth: true }),
    logout: () => request('/api/account/logout', { method: 'POST', auth: true }),
    setTxnPin: (body) => request('/api/account/txn-pin', { method: 'POST', body, auth: true }),
  },

  // ── Retailer panel ──────────────────────────────────────────────
  retailer: {
    summary: () => request('/api/retailer/summary', { auth: true }),
    serviceStats: (params = {}) => request(`/api/retailer/service-stats?${qs(params)}`, { auth: true }),
    catalogue: () => request('/api/services/catalogue', { auth: true }),
    operators: (params = {}) => request(`/api/operators?${qs(params)}`, { auth: true }),
    accountHistory: (params = {}) => request(`/api/retailer/account-history?${qs(params)}`, { auth: true }),
    serviceReport: (params = {}) => request(`/api/retailer/service-report?${qs(params)}`, { auth: true }),
    gstReport: (params = {}) => request(`/api/retailer/gst-report?${qs(params)}`, { auth: true }),
    tdsReport: (params = {}) => request(`/api/retailer/tds-report?${qs(params)}`, { auth: true }),
    commissionReport: (params = {}) => request(`/api/retailer/commission-report?${qs(params)}`, { auth: true }),
    commissionSummary: (params = {}) => request(`/api/retailer/commission-summary?${qs(params)}`, { auth: true }),
    myCommissionSlab: (params = {}) => request(`/api/retailer/my-commission-slab?${qs(params)}`, { auth: true }),
  },
  recharge: {
    plans: (params = {}) => request(`/api/recharge/plans?${qs(params)}`, { auth: true }),
    dthInfo: (params = {}) => request(`/api/recharge/dth-info?${qs(params)}`, { auth: true }),
    mobile: (body) => request('/api/recharge/mobile', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    dth: (body) => request('/api/recharge/dth', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },
  bbps: {
    fetchBill: (body) => request('/api/bbps/fetch-bill', { method: 'POST', body, auth: true }),
    pay: (body) => request('/api/bbps/pay', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    lic: (body) => request('/api/lic/pay', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    gas: (body) => request('/api/gas/pay', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    fastag: (body) => request('/api/fastag/recharge', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    moveToBank: (body) => request('/api/move-to-bank', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },
  aeps: {
    devices: () => request('/api/aeps/devices', { auth: true }),
    transact: (body) => request('/api/aeps/transact', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    aadharPay: (body) => request('/api/aadhar-pay/transact', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    microAtm: (body) => request('/api/micro-atm/transact', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },
  dmt: {
    sender: (mobile) => request('/api/dmt/sender', { method: 'POST', body: { mobile }, auth: true }),
    beneficiaries: (senderId) => request(`/api/dmt/beneficiaries?senderId=${senderId}`, { auth: true }),
    addBeneficiary: (body) => request('/api/dmt/beneficiary', { method: 'POST', body, auth: true }),
    verifyBeneficiary: (id) => request(`/api/dmt/beneficiary/${id}/verify`, { method: 'POST', auth: true }),
    transfer: (body) => request('/api/dmt/transfer', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },
  booking: {
    search: (type, params = {}) => request(`/api/booking/${type}/search?${qs(params)}`, { auth: true }),
    book: (type, body) => request(`/api/booking/${type}/book`, { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },

  // Support Tickets (retailer: owner-scoped)
  retailerTickets: {
    list: (params = {}) => request(`/api/retailer/tickets?${qs(params)}`, { auth: true }),
    get: (id) => request(`/api/retailer/tickets/${id}`, { auth: true }),
    create: (body) => request('/api/retailer/tickets', { method: 'POST', body, auth: true }),
    reply: (id, message) => request(`/api/retailer/tickets/${id}/reply`, { method: 'POST', body: { message }, auth: true }),
  },

  // Distributor / MD panel (own downline only). Same request/response shapes as the
  // admin managedUsers / fundTransfer / reports.serviceReport calls, so the admin
  // screens reuse them with a `network` prop.
  network: {
    summary: () => request('/api/network/summary', { auth: true }),
    meta: () => request('/api/network/meta', { auth: true }),
    users: {
      list: (params = {}) => request(`/api/network/users?${qs(params)}`, { auth: true }),
      // User picker: slim rows from my own downline. params: q, scope ('direct' | 'downline'), userTypeId, id, userCode, limit.
      search: (params = {}) => request(`/api/network/users/search?${qs(params)}`, { auth: true }),
      create: (body) => request('/api/network/users', { method: 'POST', body, auth: true }),
      update: (id, body) => request(`/api/network/users/${id}`, { method: 'PUT', body, auth: true }),
    },
    fundTransfer: {
      lookup: (code) => request(`/api/network/lookup?code=${encodeURIComponent(code)}`, { auth: true }),
      list: (params = {}) => request(`/api/network/fund-transfers?${qs(params)}`, { auth: true }),
      create: (body) => request('/api/network/fund-transfer', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    },
    serviceReport: (params = {}) => request(`/api/network/report?${qs(params)}`, { auth: true }),
    // My commission packages (re-share my own commission with my direct downline).
    packages: {
      meta: () => request('/api/network/packages/meta', { auth: true }),
      list: (params = {}) => request(`/api/network/packages?${qs(params)}`, { auth: true }),
      create: (body) => request('/api/network/packages', { method: 'POST', body, auth: true }),
      update: (id, body) => request(`/api/network/packages/${id}`, { method: 'PUT', body, auth: true }),
      remove: (id, unassign = false) => request(`/api/network/packages/${id}${unassign ? '?unassign=1' : ''}`, { method: 'DELETE', auth: true }),
    },
    // Fund requests from users I created (I approve them; approving moves money from my wallet).
    fundRequests: {
      list: (params = {}) => request(`/api/network/fund-requests?${qs(params)}`, { auth: true }),
      act: (id, body) => request(`/api/network/fund-requests/${id}`, { method: 'PUT', body, auth: true, idempotencyKey: idemKey() }),
    },
  },

  // KYC: my documents, and the admin's review queue. File links in responses are
  // signed and expire in 15 minutes; open them with assetUrl(link).
  kyc: {
    upload: uploadKycDocument,
    mine: () => request('/api/my/kyc', { auth: true }),
    submit: (body) => request('/api/my/kyc', { method: 'POST', body, auth: true }),
    requests: (params = {}) => request(`/api/kyc-requests?${qs(params)}`, { auth: true }),
    review: (id, body) => request(`/api/kyc-requests/${id}`, { method: 'PUT', body, auth: true }),
  },

  // Pending transactions (settled by callback / status check / admin) and reconciliation.
  pending: {
    list: (params = {}) => request(`/api/pending-transactions?${qs(params)}`, { auth: true }),
    checkAll: () => request('/api/pending-transactions/check', { method: 'POST', auth: true }),
    checkOne: (id) => request(`/api/pending-transactions/${id}/check`, { method: 'POST', auth: true }),
    settle: (id, body) => request(`/api/pending-transactions/${id}`, { method: 'PUT', body, auth: true }),
  },
  reconciliation: {
    runs: (params = {}) => request(`/api/reconciliation/runs?${qs(params)}`, { auth: true }),
    run: (date) => request('/api/reconciliation/runs', { method: 'POST', body: { date }, auth: true }),
    items: (runId, params = {}) => request(`/api/reconciliation/runs/${runId}/items?${qs(params)}`, { auth: true }),
    resolve: (id, note) => request(`/api/reconciliation/items/${id}`, { method: 'PUT', body: { note }, auth: true }),
  },

  // My own fund requests (any retailer / distributor / MD); approved by whoever created me.
  myFundRequests: {
    meta: () => request('/api/my/fund-request/meta', { auth: true }),
    list: (params = {}) => request(`/api/my/fund-requests?${qs(params)}`, { auth: true }),
    create: (body) => request('/api/my/fund-requests', { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
  },

  // Company Banks
  companyBanks: {
    list: (params = {}) => request(`/api/company-banks?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/company-banks', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/company-banks/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/company-banks/${id}`, { method: 'DELETE', auth: true }),
  },

  // Users Manager (managed portal users)
  managedUsers: {
    // params: q, userTypeId, parentUser, accountStatus, kycStatus, page, pageSize + DataGrid sort/dir/f_<col>.
    list: (params = {}) => request(`/api/users?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    // User picker: slim rows (no PAN / Aadhaar). params: q, userTypeId, id, userCode, limit (max 20).
    search: (params = {}) => request(`/api/users/search?${qs(params)}`, { auth: true }),
    create: (body) => request('/api/users', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/users/${id}`, { method: 'PUT', body, auth: true }),
    // Preview of a type / parent change: { fitsParent, parentError, childrenMismatch, planCleared, ... }.
    changeImpact: (id, params = {}) => request(`/api/users/${id}/change-impact?${qs(params)}`, { auth: true }),
    fund: (id, body) => request(`/api/users/${id}/fund`, { method: 'POST', body, auth: true, idempotencyKey: idemKey() }),
    remove: (id) => request(`/api/users/${id}`, { method: 'DELETE', auth: true }),
  },

  // All active service categories (for dropdowns)
  serviceCategoryOptions: () => request('/api/service-categories?pageSize=100', { auth: true }),

  // Reusable location data (used by City Master + any state/city dropdown)
  states: () => request('/api/states', { auth: true }),
  cities: {
    list: (params = {}) => request(`/api/cities?${qs({ page: 1, pageSize: 10, ...params })}`, { auth: true }),
    create: (body) => request('/api/cities', { method: 'POST', body, auth: true }),
    update: (id, body) => request(`/api/cities/${id}`, { method: 'PUT', body, auth: true }),
    remove: (id) => request(`/api/cities/${id}`, { method: 'DELETE', auth: true }),
  },
};
