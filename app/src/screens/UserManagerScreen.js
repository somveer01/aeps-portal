import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import ActionIcon from '../components/ActionIcon';
import UserPicker from '../components/UserPicker';
import { api } from '../api/client';
import DataGrid, { gridParams } from '../components/DataGrid';
import { colors, radius } from '../theme';
import buttonLabel from '../components/buttonLabel';
import ConfirmDialog from '../components/ConfirmDialog';
import FormBar from '../components/FormBar';
import { fmtDateTime as fmtDate } from '../utils/dateTime';

// SAP Fiori design tokens (scoped to this screen). Accent follows the app theme.
const FIORI = {
  bg: '#f5f6f7', line: '#e5e5e5', text: '#32363a', label: '#6a6d70',
  blue: colors.primary, blueDark: colors.primaryDark, blueSoft: colors.primarySoft,
  good: '#107e3e', error: '#bb0000', warn: '#e9730c', neutral: '#6a6d70',
};

const PAGE_SIZE = 10;
const ACCOUNT_OPTIONS = [{ label: 'All', value: '' }, { label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }];
const KYC_OPTIONS = [{ label: 'All', value: '' }, { label: 'Pending', value: 'pending' }, { label: 'Verified', value: 'verified' }, { label: 'Rejected', value: 'rejected' }];
const KYC_EDIT = [{ label: 'Pending', value: 'pending' }, { label: 'Verified', value: 'verified' }, { label: 'Rejected', value: 'rejected' }];
const GENDER_OPTIONS = [{ label: 'Male', value: 'male' }, { label: 'Female', value: 'female' }, { label: 'Other', value: 'other' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
// Fiori ObjectStatus: a coloured dot + semantic-coloured label.
function KycBadge({ value }) {
  const c = value === 'verified' ? FIORI.good : value === 'rejected' ? FIORI.error : FIORI.warn;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ color: c, fontWeight: '600', fontSize: 12.5, textTransform: 'capitalize' }}>{value || 'pending'}</Text>
    </View>
  );
}

// Fiori button: emphasized (filled blue), transparent (text), or default (outlined).
function FioriButton({ title, onPress, variant = 'emphasized', disabled }) {
  const [hover, setHover] = useState(false);
  const base = variant === 'emphasized' ? styles.fBtnEmph : variant === 'transparent' ? styles.fBtnGhost : styles.fBtnDefault;
  const hov = variant === 'emphasized' ? styles.fBtnEmphHover : styles.fBtnGhostHover;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      style={[styles.fBtn, base, hover && !disabled && hov, disabled && { opacity: 0.5 }]}
    >
      <Text style={[styles.fBtnText, variant === 'emphasized' && { color: '#fff' }]}>{buttonLabel(title)}</Text>
    </Pressable>
  );
}
function Checkbox({ label, checked, onToggle }) {
  return (
    <Pressable onPress={onToggle} style={styles.cbRow}>
      <View style={[styles.cbBox, checked && styles.cbBoxOn]}>{checked ? <Text style={styles.cbTick}>✓</Text> : null}</View>
      <Text style={styles.cbLabel}>{label}</Text>
    </Pressable>
  );
}
// The saved name parts; a row that was never split (older data) is split from its full name:
// first word = first name, last word = last name, anything between = middle name.
const nameParts = (r) => {
  if (r.first_name || r.middle_name || r.last_name) return { firstName: r.first_name || '', middleName: r.middle_name || '', lastName: r.last_name || '' };
  const p = String(r.name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: p[0] || '', middleName: p.slice(1, -1).join(' '), lastName: p.length > 1 ? p[p.length - 1] : '' };
};
const EMPTY = {
  userTypeId: '', firstName: '', middleName: '', lastName: '', fatherHusbandName: '', dob: '', shopName: '', email: '', mobile: '',
  panNumber: '', aadharNumber: '', gender: '', planId: '', gstNumber: '', minBalance: '', password: '',
  address: '', stateId: '', cityId: '', pincode: '', merchantId: '', parentId: '', assignedEmployeeId: '', commissionPackageId: '',
  serviceAccess: [], moduleAccess: [], kycStatus: 'pending', ekycStatus: 'pending', active: true,
};

// network: the distributor / MD panel — same screen, limited to the caller's downline,
// without the admin-only fields (KYC, service access, parent, employee, merchant, min balance).
export default function UserManagerScreen({ network = false, onDone }) {
  const usersApi = network ? api.network.users : api.managedUsers;
  const [meId, setMeId] = useState(null); const [filterTypes, setFilterTypes] = useState([]); const [fundPin, setFundPin] = useState('');
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [fUserType, setFUserType] = useState(''); const [fParent, setFParent] = useState(''); const [fAccount, setFAccount] = useState(''); const [fKyc, setFKyc] = useState('');
  const [applied, setApplied] = useState({ userTypeId: '', parentUser: '', accountStatus: '', kycStatus: '' });

  const [packages, setPackages] = useState([]); // network: my commission packages
  const [typeDefaults, setTypeDefaults] = useState([]); // [{ userTypeId, serviceId }] from Service Permissions
  const [userTypes, setUserTypes] = useState([]); const [plans, setPlans] = useState([]);
  const [states, setStates] = useState([]); const [cities, setCities] = useState([]); const [services, setServices] = useState([]); const [modules, setModules] = useState([]);
  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  // fund / view / delete
  const [fundUser, setFundUser] = useState(null); const [fundAmount, setFundAmount] = useState(''); const [fundType, setFundType] = useState('credit'); const [funding, setFunding] = useState(false); const [fundError, setFundError] = useState(null);
  const [viewUser, setViewUser] = useState(null);
  // admin: reset a user's password (temporary password shown once)
  const [resetUser, setResetUser] = useState(null); const [resetPwd, setResetPwd] = useState(''); const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null); const [resetDone, setResetDone] = useState(null); const [copied, setCopied] = useState(false);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);
  const [impact, setImpact] = useState(null); const [moveTo, setMoveTo] = useState('admin'); // type / parent change preview
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [sort, setSort] = useState(null); const [colFilters, setColFilters] = useState({}); // DataGrid

  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const res = await usersApi.list({ q: opts.q ?? q, ...applied, ...gridParams(sort, colFilters), page: opts.page ?? page, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, applied, sort, colFilters]);

  useEffect(() => {
    api.states().then((r) => setStates(r.states)).catch(() => {});
    if (network) {
      // Only the user types (and their plans) this user may create.
      api.network.packages.list({ pageSize: 100 }).then((r) => setPackages(r.rows)).catch(() => {});
      api.network.meta().then((m) => {
        setMeId(m.userId);
        setUserTypes(m.childTypes.map(({ id, name }) => ({ id, name })));
        setPlans(m.childTypes.flatMap((t) => t.plans));
      }).catch((e) => setError(e.message));
      loadFilterTypes();
      return;
    }
    api.userTypes.list({ pageSize: 100 }).then((r) => setUserTypes(r.rows)).catch(() => {});
    api.plans.list({ pageSize: 100 }).then((r) => setPlans(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100, active: true }).then((r) => setServices(r.rows)).catch(() => {});
    api.servicePermissions.matrix().then((m) => setTypeDefaults(m.allowed)).catch(() => {});
    api.moduleOptions().then((r) => setModules(r.modules)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  const firstQ = useRef(true);
  useEffect(() => {
    if (firstQ.current) { firstQ.current = false; return undefined; } // skip on mount (avoids a second load → blink)
    const t = setTimeout(() => load({ page: 1, q }), 350);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [q]);
  useEffect(() => { load({ page: 1 }); /* eslint-disable-next-line */ }, [applied, sort, colFilters]);
  // load cities when selected state changes
  useEffect(() => {
    if (!f.stateId) { setCities([]); return; }
    api.cities.list({ stateId: f.stateId, pageSize: 500 }).then((r) => setCities(r.rows)).catch(() => {});
  }, [f.stateId]);

  const applyFilters = () => setApplied({ userTypeId: fUserType, parentUser: fParent.trim(), accountStatus: fAccount, kycStatus: fKyc });
  // Network filter: every user type present in the downline (an MD also has retailers below).
  function loadFilterTypes() {
    api.network.users.list({ pageSize: 100 }).then((r) => {
      const seen = new Map(); r.rows.forEach((u) => seen.set(u.user_type_id, u.user_type_name));
      setFilterTypes([...seen].map(([id, name]) => ({ id, name })));
    }).catch(() => {});
  }

  const utOptions = userTypes.map((u) => ({ label: u.name, value: u.id }));
  const utFilterOptions = [{ label: 'All', value: '' }, ...(network ? filterTypes : userTypes).map((u) => ({ label: u.name, value: u.id }))];
  const stateOptions = states.map((s) => ({ label: s.name, value: s.id }));
  const cityOptions = cities.map((c) => ({ label: c.name, value: c.id }));
  const planOptions = useMemo(() => {
    const filtered = plans.filter((p) => String(p.user_type_id) === String(f.userTypeId));
    return [{ label: '— None —', value: '' }, ...(filtered.length || network ? filtered : plans).map((p) => ({ label: p.name, value: p.id }))];
  }, [plans, f.userTypeId, network]);
  // Types above a type in the User Type tree (nearest first): users of these may be its parent.
  const typesAbove = (typeId) => {
    const out = []; const seen = new Set();
    let t = userTypes.find((u) => String(u.id) === String(typeId));
    while (t && t.parent_type_id && !seen.has(t.parent_type_id)) {
      seen.add(t.parent_type_id); out.push(String(t.parent_type_id));
      t = userTypes.find((u) => u.id === t.parent_type_id);
    }
    return out;
  };
  // Where users below can go when a type change leaves them unfit: the admin (empty), or a user of a type that
  // sits above ALL of them. The parent picker lists users of the types above the selected type.
  const moveTypes = useMemo(() => {
    const kids = impact?.childrenMismatch || [];
    if (!kids.length) return [];
    const lists = kids.map((c) => typesAbove(c.user_type_id));
    return lists[0].filter((t) => lists.every((l) => l.includes(t)));
    /* eslint-disable-next-line */
  }, [impact, userTypes]);
  const employeeTypeId = (userTypes.find((t) => String(t.name || '').toLowerCase() === 'employee') || {}).id;

  // Service Access starts from the user type's default (Modules → Service Permissions).
  const defaultServices = (typeId) => typeDefaults.filter((a) => String(a.userTypeId) === String(typeId)).map((a) => a.serviceId);
  const openAdd = () => { const t = userTypes[0]?.id ?? ''; setEditing(null); setF({ ...EMPTY, userTypeId: t, serviceAccess: defaultServices(t) }); setFormError(null); setView('form'); };
  const openEdit = (r) => {
    setEditing(r);
    setF({
      userTypeId: r.user_type_id, ...nameParts(r), fatherHusbandName: r.father_husband_name || '', dob: r.dob || '',
      shopName: r.shop_name || '', email: r.email || '', mobile: r.mobile || '', panNumber: r.pan_number || '',
      aadharNumber: r.aadhar_number || '', gender: r.gender || '', planId: r.plan_id || '', gstNumber: r.gst_number || '',
      minBalance: r.min_balance != null ? String(r.min_balance) : '', password: '',
      address: r.address || '', stateId: r.state_id || '', cityId: r.city_id || '', pincode: r.pincode || '',
      merchantId: r.merchant_id || '', parentId: r.parent_role === 'admin' ? '' : (r.parent_id || ''), assignedEmployeeId: r.assigned_employee_id || '', commissionPackageId: r.commission_package_id || '',
      serviceAccess: r.service_access || [], moduleAccess: r.module_access || [],
      kycStatus: r.kyc_status, ekycStatus: r.ekyc_status, active: r.is_active,
    });
    setFormError(null); setImpact(null); setMoveTo('admin'); setView('form');
  };

  // Editing: preview what a type / parent change does (users below, plan, packages, sign-out).
  useEffect(() => {
    if (network || !editing || view !== 'form') { setImpact(null); return undefined; }
    const curParent = editing.parent_role === 'admin' || !editing.parent_id ? '' : String(editing.parent_id);
    const changed = String(f.userTypeId) !== String(editing.user_type_id) || String(f.parentId || '') !== curParent;
    if (!changed) { setImpact(null); return undefined; }
    const t = setTimeout(() => {
      api.managedUsers.changeImpact(editing.id, { userTypeId: f.userTypeId, parentId: f.parentId || 'admin' }).then(setImpact).catch(() => setImpact(null));
    }, 300);
    return () => clearTimeout(t);
  }, [f.userTypeId, f.parentId, editing, view, network]);

  const toggleInArray = (key, val) => setF((p) => {
    const list = p[key] || []; const has = list.some((x) => String(x) === String(val));
    return { ...p, [key]: has ? list.filter((x) => String(x) !== String(val)) : [...list, val] };
  });
  const selectedType = userTypes.find((u) => String(u.id) === String(f.userTypeId)) || {};
  const selectedTypeName = selectedType.name || '';
  // A type with no Parent Type (e.g. Super Distributor) always sits under the admin; the API enforces it too.
  const parentIsAdmin = !network && !!selectedType.id && !selectedType.parent_type_id;
  const isEmployee = selectedTypeName.toLowerCase() === 'employee';
  const allServiceIds = services.map((s) => s.id);
  const allModuleRoutes = modules.map((m) => m.route);
  const toggleAll = (key, allVals) => setF((p) => ({ ...p, [key]: (p[key] || []).length === allVals.length ? [] : [...allVals] }));

  const invalid = (msg) => setFormError(msg); // shown in the sticky bar at the top, wherever the page is scrolled
  const save = async () => {
    if (!f.firstName.trim()) { invalid('First name is required.'); return; }
    if (!f.lastName.trim()) { invalid('Last name is required.'); return; }
    if (!/^\d{10}$/.test(f.mobile.trim())) { invalid('Mobile must be 10 digits.'); return; }
    if (!f.userTypeId) { invalid('Please select an account type.'); return; }
    if (!editing && f.password.length < 6) { invalid('Password must be at least 6 characters.'); return; }
    setSaving(true); setFormError(null);
    const body = {
      firstName: f.firstName.trim(), middleName: f.middleName.trim(), lastName: f.lastName.trim(),
      fatherHusbandName: f.fatherHusbandName, dob: f.dob, shopName: f.shopName, email: f.email, mobile: f.mobile,
      panNumber: f.panNumber, aadharNumber: f.aadharNumber, gender: f.gender, userTypeId: f.userTypeId, planId: f.planId || null,
      gstNumber: f.gstNumber, minBalance: f.minBalance || 0, address: f.address, stateId: f.stateId || null, cityId: f.cityId || null,
      pincode: f.pincode, merchantId: f.merchantId, parentId: f.parentId || null, assignedEmployeeId: f.assignedEmployeeId || null,
      serviceAccess: f.serviceAccess, moduleAccess: f.moduleAccess, isActive: f.active,
    };
    // Network panel: my commission package for a user directly under me ('' = admin default).
    if (network && (!editing || editing.parent_id === meId)) body.commissionPackageId = f.commissionPackageId || null;
    // A type change that leaves users below unfit moves them in the same save.
    if (!network && impact?.childrenMismatch?.length) body.moveChildrenTo = moveTo || 'admin';
    try {
      if (editing) { body.kycStatus = f.kycStatus; body.ekycStatus = f.ekycStatus; await usersApi.update(editing.id, body); }
      else { body.password = f.password; await usersApi.create(body); }
      setView('list'); await load({ page: editing ? page : 1 });
      if (network) loadFilterTypes();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };
  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await usersApi.update(row.id, { isActive: !row.is_active }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };
  const openFund = (row) => { setFundUser(row); setFundAmount(''); setFundType('credit'); setFundPin(''); setFundError(null); };
  const [fundConfirm, setFundConfirm] = useState(false); // "Add ₹X to ...?" dialog on top of the fund form
  const submitFund = () => {
    const amt = Number(fundAmount);
    if (!Number.isFinite(amt) || amt <= 0) { setFundError('Enter a valid amount.'); return; }
    if (network && !fundPin) { setFundError('Enter your transaction PIN or login password.'); return; }
    setFundError(null); setFundConfirm(true);
  };
  const doFund = async () => {
    const amt = Number(fundAmount);
    setFundConfirm(false); setFunding(true); setFundError(null);
    try {
      // Network: a zero-sum transfer from my wallet. Admin: a direct wallet adjustment.
      if (network) await api.network.fundTransfer.create({ userId: fundUser.id, amount: amt, txnType: fundType, transactionPassword: fundPin });
      else await api.managedUsers.fund(fundUser.id, { amount: amt, type: fundType });
      setFundUser(null); await load({ page });
      if (onDone) onDone();
    } catch (e) { setFundError(e.message); } finally { setFunding(false); }
  };
  const openReset = (row) => { setResetUser(row); setResetPwd(''); setResetError(null); setResetDone(null); setCopied(false); };
  const closeReset = () => { setResetUser(null); setResetDone(null); setResetPwd(''); };
  const submitReset = async () => {
    if (resetPwd && resetPwd.length < 8) { setResetError('Password must be at least 8 characters, or leave it empty to generate one.'); return; }
    setResetting(true); setResetError(null);
    try { const res = await api.managedUsers.resetPassword(resetUser.id, resetPwd ? { newPassword: resetPwd } : {}); setResetDone(res.password); setResetPwd(''); }
    catch (e) { setResetError(e.message); } finally { setResetting(false); }
  };
  const copyPassword = () => {
    try { navigator.clipboard.writeText(resetDone).then(() => setCopied(true), () => {}); } catch { /* no clipboard (native): the text is selectable */ }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.managedUsers.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); }
    catch (e) { setToDelete(null); setError(e.message); } finally { setDeleting(false); } // e.g. HAS_DOWNLINE / HAS_HISTORY: deactivate instead
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  // ── FORM VIEW ──────────────────────────────────────────────
  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <FormBar saveTitle={editing ? 'Save' : 'Create User'} onSave={save} saving={saving}
          onCancel={() => setView('list')} backTitle="← Back" onBack={() => setView('list')} error={formError} />
        <Card>

          <Text style={styles.section}>Basic Details</Text>
          <View style={styles.grid}>
            {network && editing ? (
              <View style={styles.field}><Text style={styles.label}>Account Type</Text><Text style={[styles.input, { color: colors.muted }]}>{editing.user_type_name}</Text></View>
            ) : (
              <View style={styles.field}><Select label="Select Account Type *" value={f.userTypeId} options={utOptions} onChange={(v) => { set('userTypeId', v); set('planId', ''); if (!network) set('serviceAccess', defaultServices(v)); }} placeholder="-- Choose --" /></View>
            )}
            <Field label="First Name *" value={f.firstName} onChange={(v) => set('firstName', v)} placeholder="First name" maxLength={80} autoCap="words" />
            <Field label="Middle Name" value={f.middleName} onChange={(v) => set('middleName', v)} placeholder="Middle name (optional)" maxLength={80} autoCap="words" />
            <Field label="Last Name *" value={f.lastName} onChange={(v) => set('lastName', v)} placeholder="Last name" maxLength={80} autoCap="words" />
            <Field label="Father's / Husband Name" value={f.fatherHusbandName} onChange={(v) => set('fatherHusbandName', v)} placeholder="Name" />
            <View style={styles.field}><DateField label="DOB" value={f.dob} onChange={(v) => set('dob', v)} /></View>
            <Field label="Shop Name" value={f.shopName} onChange={(v) => set('shopName', v)} placeholder="Firm name" />
            <Field label="Email" value={f.email} onChange={(v) => set('email', v)} placeholder="Email address" />
            <Field label="Mobile *" value={f.mobile} onChange={(v) => set('mobile', v)} placeholder="10-digit mobile" keyboardType="numeric" maxLength={10} />
            <Field label="PAN Number" value={f.panNumber} onChange={(v) => set('panNumber', v)} placeholder="PAN" autoCap="characters" />
            <Field label="Aadhaar Number" value={f.aadharNumber} onChange={(v) => set('aadharNumber', v)} placeholder="12-digit Aadhaar" keyboardType="numeric" maxLength={12} />
            <View style={styles.field}><Select label="Gender" value={f.gender} options={GENDER_OPTIONS} onChange={(v) => set('gender', v)} placeholder="Select" searchable={false} /></View>
            <View style={styles.field}><Select label="Plan Name" value={f.planId} options={planOptions} onChange={(v) => set('planId', v)} placeholder="-- Select Plan --" /></View>
            <Field label="GST Number" value={f.gstNumber} onChange={(v) => set('gstNumber', v)} placeholder="GST (optional)" />
            {!network ? <Field label="Min Balance" value={f.minBalance} onChange={(v) => set('minBalance', v)} placeholder="0" keyboardType="numeric" /> : null}
            {!editing ? <Field label="Password *" value={f.password} onChange={(v) => set('password', v)} placeholder="Min 6 characters" secure /> : null}
          </View>

          <Text style={styles.section}>Address Details</Text>
          <View style={styles.grid}>
            <Field label="Address" value={f.address} onChange={(v) => set('address', v)} placeholder="Full address" />
            <View style={styles.field}><Select label="State" value={f.stateId} options={stateOptions} onChange={(v) => { set('stateId', v); set('cityId', ''); }} placeholder="-- Choose State --" /></View>
            <View style={styles.field}><Select label="City" value={f.cityId} options={cityOptions} onChange={(v) => set('cityId', v)} placeholder="-- Choose City --" /></View>
            <Field label="Pincode" value={f.pincode} onChange={(v) => set('pincode', v)} placeholder="Pincode" keyboardType="numeric" maxLength={6} />
          </View>

          {network ? (
            <>
              {!editing || editing.parent_id === meId ? (
                <View style={styles.grid}>
                  <View style={styles.field}><Select label="Commission Package" value={f.commissionPackageId} onChange={(v) => set('commissionPackageId', v)} searchable={false}
                    options={[{ label: 'Admin default', value: '' }, ...packages.filter((p) => p.is_active && String(p.user_type_id) === String(f.userTypeId)).map((p) => ({ label: p.name, value: p.id }))]} /></View>
                </View>
              ) : null}
              <Text style={styles.hint}>{editing ? `${editing.user_code} stays in your network.` : 'The new user is placed directly under you.'} A commission package (My Network → Commission Packages) sets what they earn out of your own share. Their KYC, service access and merchant ID are set by the admin.</Text>
            </>
          ) : (
          <>
          <Text style={styles.section}>AEPS / Parent Details</Text>
          <View style={styles.grid}>
            <Field label="Merchant ID" value={f.merchantId} onChange={(v) => set('merchantId', v)} placeholder="Submerchant ID" />
            {parentIsAdmin ? (
              <View style={styles.field}>
                <Text style={styles.label}>Parent Id</Text>
                <TextInput value="Admin (fixed)" editable={false} style={[styles.input, { color: colors.muted }]} />
              </View>
            ) : (
              <View style={styles.field}><UserPicker label="Parent Id" mode="admin" userTypeId={typesAbove(f.userTypeId)} disabled={!f.userTypeId} value={f.parentId} onChange={(v) => set('parentId', v)} placeholder="Admin (default)" /></View>
            )}
            <View style={styles.field}><UserPicker label="Assigned Employee" mode="admin" userTypeId={employeeTypeId} disabled={!employeeTypeId} value={f.assignedEmployeeId} onChange={(v) => set('assignedEmployeeId', v)} placeholder="-- None --" /></View>
          </View>
          {!parentIsAdmin ? <Text style={styles.hint}>Only users of a type above {selectedTypeName || 'this type'} are listed. No parent = the admin.</Text> : null}

          {impact ? (
            <View style={styles.impactBox}>
              <Text style={styles.impactTitle}>What this change does</Text>
              {impact.parentError ? <Text style={styles.impactBad}>{impact.parentError.error}</Text> : null}
              {impact.childrenMismatch.length ? (
                <>
                  <Text style={styles.impactLine}>
                    {impact.childrenMismatch.length} user(s) below cannot stay under a {selectedTypeName}: {impact.childrenMismatch.map((c) => `${c.code} (${c.type})`).join(', ')}.
                  </Text>
                  <View style={[styles.field, { maxWidth: 420 }]}><UserPicker label="Move these users to *" mode="admin" userTypeId={moveTypes} disabled={!moveTypes.length} value={moveTo === 'admin' ? '' : moveTo} onChange={(v) => setMoveTo(v || 'admin')} placeholder="Admin" /></View>
                </>
              ) : null}
              {impact.planCleared ? <Text style={styles.impactLine}>The plan is removed (it was made for the old type).</Text> : null}
              {impact.packageCleared ? <Text style={styles.impactLine}>The commission package this user received is removed.</Text> : null}
              {impact.ownedPackagesDeactivated.length ? <Text style={styles.impactLine}>Their own packages are switched off: {impact.ownedPackagesDeactivated.map((p) => p.name).join(', ')}.</Text> : null}
              {impact.signsOut ? <Text style={styles.impactLine}>The user is signed out and gets the new panel at the next login.</Text> : null}
              {!impact.parentError ? <Text style={styles.impactLine}>Past commission records stay as they are.</Text> : null}
            </View>
          ) : null}

          <View style={styles.sectionRow}>
            <Text style={styles.section}>Service Access</Text>
            <Pressable onPress={() => toggleAll('serviceAccess', allServiceIds)}><Text style={styles.checkAll}>{(f.serviceAccess || []).length === allServiceIds.length && allServiceIds.length ? 'Uncheck All' : 'Check All'}</Text></Pressable>
          </View>
          <Text style={styles.hint}>Ticked = this user may use the service. Ticks start from the account type's default in Modules → Service Permissions; only differences are saved for this user.</Text>
          <View style={styles.cbGrid}>
            {services.map((s) => (
              <Checkbox key={s.id} label={s.title} checked={(f.serviceAccess || []).some((x) => String(x) === String(s.id))} onToggle={() => toggleInArray('serviceAccess', s.id)} />
            ))}
          </View>

          {isEmployee ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.section}>Employee Module Access</Text>
                <Pressable onPress={() => toggleAll('moduleAccess', allModuleRoutes)}><Text style={styles.checkAll}>{(f.moduleAccess || []).length === allModuleRoutes.length && allModuleRoutes.length ? 'Uncheck All' : 'Check All'}</Text></Pressable>
              </View>
              <View style={styles.cbGrid}>
                {modules.map((m) => (
                  <Checkbox key={m.route} label={m.title} checked={(f.moduleAccess || []).some((x) => x === m.route)} onToggle={() => toggleInArray('moduleAccess', m.route)} />
                ))}
              </View>
            </>
          ) : null}
          </>
          )}

          {editing && !network ? (
            <>
              <Text style={styles.section}>KYC & Status</Text>
              <View style={styles.grid}>
                <View style={styles.field}><Select label="KYC Status" value={f.kycStatus} options={KYC_EDIT} onChange={(v) => set('kycStatus', v)} searchable={false} /></View>
                <View style={styles.field}><Select label="E-KYC Status" value={f.ekycStatus} options={KYC_EDIT} onChange={(v) => set('ekycStatus', v)} searchable={false} /></View>
                <View style={[styles.field, styles.switchField]}><Text style={styles.label}>Active</Text><Switch value={f.active} onValueChange={(v) => set('active', v)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
              </View>
            </>
          ) : (
            <View style={[styles.switchField, { marginTop: 14 }]}><Text style={styles.label}>Active</Text><Switch value={f.active} onValueChange={(v) => set('active', v)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
          )}

        </Card>
      </View>
    );
  }

  // ── LIST VIEW ──────────────────────────────────────────────
  return (
    <View style={styles.fPage}>
      {/* Filter bar (with the primary Create action in its header) */}
      <View style={styles.fPanel}>
        <View style={styles.filterHead}>
          <Text style={styles.fPanelTitle}>Filters</Text>
          <FioriButton title="+ Create User" onPress={openAdd} variant="emphasized" />
        </View>
        <View style={styles.grid}>
          <View style={styles.field}><Select label="User Type" value={fUserType} options={utFilterOptions} onChange={setFUserType} placeholder="All" /></View>
          <Field label="Parent User" value={fParent} onChange={setFParent} placeholder="Parent code / name" />
          <View style={styles.field}><Select label="Account Status" value={fAccount} options={ACCOUNT_OPTIONS} onChange={setFAccount} searchable={false} /></View>
          <View style={styles.field}><Select label="KYC Status" value={fKyc} options={KYC_OPTIONS} onChange={setFKyc} searchable={false} /></View>
          <View style={styles.goField}><FioriButton title="Go" onPress={applyFilters} variant="emphasized" /></View>
        </View>
      </View>

      {/* Table */}
      <View style={styles.fPanel}>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No users found."
          sort={sort} onSort={setSort} filters={colFilters} onFilter={setColFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (row, i) => <Text style={styles.td}>{from + i}</Text> },
            { key: 'shop_name', title: 'Shop Name', width: 140 },
            { key: 'name', title: 'Name', width: 140 },
            { key: 'mobile', title: 'Mobile', width: 120 },
            { key: 'user_code', title: 'User Id', width: 110 },
            { key: 'user_type', title: 'User Type', width: 140, render: (row) => <Text style={styles.td}>{row.user_type_name}</Text> },
            { key: 'email', title: 'Email Id', width: 190, render: (row) => <Text style={styles.td} numberOfLines={1}>{row.email || '—'}</Text> },
            { key: 'wallet', title: 'Wallet', width: 110, render: (row) => <Text style={styles.td}>{money(row.wallet_balance)}</Text> },
            { key: 'plan', title: 'Plan', width: 140, render: (row) => <Text style={styles.td}>{row.plan_name || '—'}</Text> },
            { key: 'join_date', title: 'Join Date', width: 175, render: (row) => <Text style={styles.td}>{fmtDate(row.join_date)}</Text> },
            { key: 'parent', title: 'Parent Id', width: 115, render: (row) => <Text style={styles.td}>{row.parent_code || '—'}</Text> },
            { key: 'created_by', title: 'Created By', width: 140, render: (row) => <View><Text style={styles.td} numberOfLines={1}>{row.created_by_code || '—'}</Text>{row.created_by_name ? <Text style={styles.sub} numberOfLines={1}>{row.created_by_name}</Text> : null}</View> },
            { key: 'status', title: 'Status', width: 95, render: (row) => <Switch value={!!row.is_active} onValueChange={() => toggleStatus(row)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /> },
            { key: 'ekyc', title: 'E-Kyc', width: 100, render: (row) => <KycBadge value={row.ekyc_status} /> },
            { key: 'kyc', title: 'Kyc', width: 100, render: (row) => <KycBadge value={row.kyc_status} /> },
            { key: 'package', title: 'Package', width: 140, render: (row) => <Text style={styles.td}>{row.commission_package_name || 'Admin default'}</Text> },
            { key: 'action', title: 'Action', width: network ? 150 : 200, sortable: false, filterable: false, render: (row) => (
              <View style={styles.actions}>
                {/* In the network panel money moves only to users directly under you. */}
                {!network || row.parent_id === meId ? <ActionIcon name="fund" onPress={() => openFund(row)} /> : null}
                <ActionIcon name="view" onPress={() => setViewUser(row)} />
                <ActionIcon name="edit" onPress={() => openEdit(row)} />
                {!network ? <ActionIcon name="key" onPress={() => openReset(row)} /> : null}
                {!network ? <ActionIcon name="delete" onPress={() => setToDelete(row)} /> : null}
              </View>
            ) },
          ]}
        />
        <View style={styles.pagination}>
          <Text style={styles.entries}>Showing {from} to {to} of {total} entries</Text>
          <View style={styles.pager}>
            <Pressable disabled={page <= 1} onPress={() => load({ page: page - 1 })} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Previous</Text></Pressable>
            <View style={[styles.pageBtn, styles.pageCurrent]}><Text style={{ color: '#fff', fontWeight: '700' }}>{page}</Text></View>
            <Pressable disabled={page >= totalPages} onPress={() => load({ page: page + 1 })} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Next</Text></Pressable>
          </View>
        </View>
      </View>

      {/* Fund modal */}
      <ConfirmDialog
        visible={fundConfirm} danger={fundType === 'debit'} title={fundType === 'debit' ? 'Confirm Deduction' : 'Confirm Credit'}
        message={fundUser ? `${fundType === 'debit' ? 'Deduct' : 'Add'} ${money(fundAmount)} ${fundType === 'debit' ? 'from' : 'to'} ${fundUser.name} (${fundUser.user_code})'s wallet?${network ? (fundType === 'debit' ? ' The amount comes back to your wallet.' : ' The amount is taken from your wallet.') : ''}` : ''}
        confirmText={fundType === 'debit' ? 'Deduct Now' : 'Add Now'} onConfirm={doFund} onCancel={() => setFundConfirm(false)}
      />

      <Modal visible={!!fundUser} transparent animationType="fade" onRequestClose={() => setFundUser(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Fund Wallet</Text>
            <Text style={styles.para}>{fundUser?.name} ({fundUser?.user_code}) · Balance {money(fundUser?.wallet_balance)}</Text>
            {fundError ? <Alert type="error">{fundError}</Alert> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setFundType('credit')} style={[styles.typeBtn, fundType === 'credit' && styles.typeBtnOn]}><Text style={fundType === 'credit' ? styles.typeOnText : styles.typeText}>Credit</Text></Pressable>
              <Pressable onPress={() => setFundType('debit')} style={[styles.typeBtn, fundType === 'debit' && styles.typeBtnOnRed]}><Text style={fundType === 'debit' ? styles.typeOnText : styles.typeText}>Debit</Text></Pressable>
            </View>
            <TextInput value={fundAmount} onChangeText={setFundAmount} keyboardType="numeric" placeholder="Amount (₹)" placeholderTextColor={colors.muted} style={styles.input} autoFocus />
            {network ? (
              <>
                <TextInput value={fundPin} onChangeText={setFundPin} secureTextEntry placeholder="Transaction PIN / login password" placeholderTextColor={colors.muted} style={styles.input} />
                <Text style={styles.hint}>Credit moves money from your wallet to this user; debit takes it back into your wallet.</Text>
              </>
            ) : null}
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setFundUser(null)} style={{ flex: 1 }} />
              <Button title={fundType === 'debit' ? 'Debit' : 'Credit'} onPress={submitFund} loading={funding} style={{ flex: 1, backgroundColor: fundType === 'debit' ? colors.danger : colors.success }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Reset password modal (admin) */}
      <Modal visible={!!resetUser} transparent animationType="fade" onRequestClose={closeReset}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <Text style={styles.para}>{resetUser?.name} ({resetUser?.user_code})</Text>
            {resetDone ? (
              <>
                <Alert type="success">Password reset. Give this temporary password to the user - it is shown only once.</Alert>
                <Text selectable style={styles.tempPwd}>{resetDone}</Text>
                <Text style={styles.hint}>The user is signed out everywhere and must choose a new password at the next login.</Text>
                <View style={styles.modalActions}>
                  <Button title={copied ? 'Copied' : 'Copy'} variant="ghost" onPress={copyPassword} style={{ flex: 1 }} />
                  <Button title="Done" onPress={closeReset} style={{ flex: 1 }} />
                </View>
              </>
            ) : (
              <>
                {resetError ? <Alert type="error">{resetError}</Alert> : null}
                <Text style={styles.hint}>This signs the user out everywhere, unlocks the account and makes them choose a new password at the next login.</Text>
                <TextInput value={resetPwd} onChangeText={setResetPwd} placeholder="New password (optional, min 8) - empty = generate one" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
                <View style={styles.modalActions}>
                  <Button title="Cancel" variant="ghost" onPress={closeReset} style={{ flex: 1 }} />
                  <Button title="Reset password" onPress={submitReset} loading={resetting} style={{ flex: 1 }} />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* View details modal */}
      <Modal visible={!!viewUser} transparent animationType="fade" onRequestClose={() => setViewUser(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 520 }]}>
            <Text style={styles.modalTitle}>User Details</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {viewUser ? [
                ['User Id', viewUser.user_code], ['Name', viewUser.name], ['Shop Name', viewUser.shop_name || '—'],
                ['User Type', viewUser.user_type_name], ['Mobile', viewUser.mobile], ['Email', viewUser.email || '—'],
                ['Wallet', money(viewUser.wallet_balance)], ['Plan', viewUser.plan_name || '—'], ['Parent', viewUser.parent_code || '—'],
                ['Created By', viewUser.created_by_code ? `${viewUser.created_by_code}${viewUser.created_by_name ? ` (${viewUser.created_by_name})` : ''}` : '—'],
                ['PAN', viewUser.pan_number || '—'], ['Aadhaar', viewUser.aadhar_number || '—'], ['Gender', viewUser.gender || '—'],
                ['DOB', viewUser.dob || '—'], ['State', viewUser.state_name || '—'], ['City', viewUser.city_name || '—'],
                ['Pincode', viewUser.pincode || '—'], ['Merchant Id', viewUser.merchant_id || '—'],
                ['KYC', viewUser.kyc_status], ['E-KYC', viewUser.ekyc_status], ['Join Date', fmtDate(viewUser.join_date)],
              ].map(([k, v]) => (
                <View key={k} style={styles.detailRow}><Text style={styles.detailLabel}>{k}</Text><Text style={styles.detailValue}>{String(v)}</Text></View>
              )) : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <Button title="Close" variant="ghost" onPress={() => setViewUser(null)} style={{ flex: 1 }} />
              <Button title="Edit" onPress={() => { const u = viewUser; setViewUser(null); openEdit(u); }} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete confirm modal */}
      <Modal visible={!!toDelete} transparent animationType="fade" onRequestClose={() => setToDelete(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete User</Text>
            <Text style={styles.para}>Delete <Text style={{ fontWeight: '700' }}>{toDelete?.name}</Text> ({toDelete?.user_code})? This cannot be undone.</Text>
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setToDelete(null)} style={{ flex: 1 }} />
              <Button title="Delete" onPress={confirmDelete} loading={deleting} style={{ flex: 1, backgroundColor: colors.danger }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, maxLength, secure, autoCap }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted}
        keyboardType={keyboardType} maxLength={maxLength} secureTextEntry={secure} autoCapitalize={autoCap || 'none'} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  // ── SAP Fiori chrome (this screen) ──────────────────────────────
  fPage: { gap: 12 },
  fHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: FIORI.line, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16 },
  fTitle: { fontSize: 18, fontWeight: '700', color: FIORI.text, letterSpacing: -0.2 },
  fSubtitle: { fontSize: 12.5, color: FIORI.label, marginTop: 1 },
  fPanel: { backgroundColor: '#fff', borderWidth: 1, borderColor: FIORI.line, borderRadius: 8, padding: 16 },
  fPanelHead: { marginBottom: 12 },
  fPanelTitle: { fontSize: 13, fontWeight: '700', color: FIORI.label, textTransform: 'uppercase', letterSpacing: 0.6 },
  filterHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  // Go cell sits in the same row as the filters, bottom-aligned, content width.
  goField: { flexGrow: 0, flexBasis: 'auto', minWidth: 72, justifyContent: 'flex-end', alignItems: 'flex-start' },
  fToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: FIORI.line },
  fToolbarTitle: { fontSize: 15, fontWeight: '700', color: FIORI.text },
  fCount: { color: FIORI.label, fontWeight: '600' },
  fBtn: { borderRadius: 4, paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  fBtnText: { fontSize: 13.5, fontWeight: '600', color: FIORI.blue },
  fBtnEmph: { backgroundColor: FIORI.blue, borderColor: FIORI.blue },
  fBtnEmphHover: { backgroundColor: FIORI.blueDark, borderColor: FIORI.blueDark },
  fBtnDefault: { backgroundColor: '#fff', borderColor: FIORI.blue },
  fBtnGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  fBtnGhostHover: { backgroundColor: FIORI.blueSoft },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  foundText: { fontSize: 18, fontWeight: '700', color: colors.text },
  formHeaderBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  // Save / Cancel / Back (and the error message) stay on screen while the long form scrolls (web; native just sits at the top)
  formStickyBar: { gap: 8, paddingVertical: 8, ...Platform.select({ web: { position: 'sticky', top: 0, zIndex: 30, backgroundColor: colors.contentBg }, default: {} }) },
  formHeading: { fontSize: 20, fontWeight: '700', color: colors.text },
  formActions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 12, marginTop: 20 },
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  checkAll: { color: colors.primary, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 14 },
  field: { flexGrow: 1, flexBasis: '22%', minWidth: 200, gap: 6 },
  switchField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cbGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  cbRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '25%', minWidth: 180, paddingVertical: 7 },
  cbBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cbBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  cbTick: { color: '#fff', fontSize: 13, fontWeight: '800' },
  cbLabel: { color: colors.text, fontSize: 13.5, flexShrink: 1 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchLabel: { color: colors.muted },
  search: { borderWidth: 1, borderColor: FIORI.line, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, minWidth: 220, color: FIORI.text, backgroundColor: '#fff', outlineStyle: 'none' },
  input: { minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7, fontSize: 14, color: colors.text, outlineStyle: 'none' },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  trAlt: { backgroundColor: '#f8fafc' },
  th: { backgroundColor: colors.primary, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  thText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  cell: { paddingVertical: 12, paddingHorizontal: 8 },
  td: { color: colors.text, fontSize: 13 },
  sub: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  cNo: { width: 36 }, cWide: { width: 130 }, cMob: { width: 105 }, cId: { width: 90 }, cType: { width: 110 }, cEmail: { width: 180 }, cWallet: { width: 80 }, cPlan: { width: 120 }, cDate: { width: 110 }, cParent: { width: 100 }, cCreated: { width: 130 }, cStatus: { width: 70 }, cKyc: { width: 85 }, cAction: { width: 130 },
  actions: { flexDirection: 'row', gap: 6 },
  detailRow: { flexDirection: 'row', paddingVertical: 5 },
  detailLabel: { width: 130, color: colors.muted, fontSize: 13 },
  detailValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 14 },
  impactBox: { marginTop: 14, padding: 14, gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: '#fcd34d', backgroundColor: '#fffbeb' },
  impactTitle: { fontWeight: '800', color: colors.text, fontSize: 14 },
  impactLine: { color: colors.text, fontSize: 13, lineHeight: 19 },
  impactBad: { color: colors.danger, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  empty: { padding: 30, alignItems: 'center' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: FIORI.line, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 }, pageBtnText: { color: FIORI.blue, fontWeight: '600' }, pageCurrent: { backgroundColor: FIORI.blue, borderColor: FIORI.blue },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 420, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  tempPwd: { fontSize: 22, fontWeight: '700', letterSpacing: 1.5, textAlign: 'center', color: colors.text, backgroundColor: colors.bg, borderRadius: 8, paddingVertical: 14, ...(Platform.OS === 'web' ? { userSelect: 'all' } : {}) },
  para: { color: colors.text, lineHeight: 21 },
  typeBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  typeBtnOn: { backgroundColor: colors.success, borderColor: colors.success },
  typeBtnOnRed: { backgroundColor: colors.danger, borderColor: colors.danger },
  typeText: { color: colors.text, fontWeight: '600' },
  typeOnText: { color: '#fff', fontWeight: '700' },
});
