import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Switch, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Card, Button, Alert, Select, DateField } from '../components/UI';
import { api } from '../api/client';
import { colors, radius } from '../theme';

const PAGE_SIZE = 10;
const ACCOUNT_OPTIONS = [{ label: 'All', value: '' }, { label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }];
const KYC_OPTIONS = [{ label: 'All', value: '' }, { label: 'Pending', value: 'pending' }, { label: 'Verified', value: 'verified' }, { label: 'Rejected', value: 'rejected' }];
const KYC_EDIT = [{ label: 'Pending', value: 'pending' }, { label: 'Verified', value: 'verified' }, { label: 'Rejected', value: 'rejected' }];
const GENDER_OPTIONS = [{ label: 'Male', value: 'male' }, { label: 'Female', value: 'female' }, { label: 'Other', value: 'other' }];
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
function fmtDate(s) {
  if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}
function KycBadge({ value }) {
  const c = value === 'verified' ? colors.success : value === 'rejected' ? colors.danger : colors.muted;
  return <Text style={{ color: c, fontWeight: '600', fontSize: 12.5, textTransform: 'capitalize' }}>{value || 'pending'}</Text>;
}
function Checkbox({ label, checked, onToggle }) {
  return (
    <Pressable onPress={onToggle} style={styles.cbRow}>
      <View style={[styles.cbBox, checked && styles.cbBoxOn]}>{checked ? <Text style={styles.cbTick}>✓</Text> : null}</View>
      <Text style={styles.cbLabel}>{label}</Text>
    </Pressable>
  );
}
const EMPTY = {
  userTypeId: '', name: '', fatherHusbandName: '', dob: '', shopName: '', email: '', mobile: '',
  panNumber: '', aadharNumber: '', gender: '', planId: '', gstNumber: '', minBalance: '', password: '',
  address: '', stateId: '', cityId: '', pincode: '', merchantId: '', parentId: '', assignedEmployeeId: '',
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

  const [userTypes, setUserTypes] = useState([]); const [plans, setPlans] = useState([]); const [parents, setParents] = useState([]);
  const [states, setStates] = useState([]); const [cities, setCities] = useState([]); const [services, setServices] = useState([]); const [modules, setModules] = useState([]);
  const [view, setView] = useState('list'); const [editing, setEditing] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState(null);
  // fund / view / delete
  const [fundUser, setFundUser] = useState(null); const [fundAmount, setFundAmount] = useState(''); const [fundType, setFundType] = useState('credit'); const [funding, setFunding] = useState(false); const [fundError, setFundError] = useState(null);
  const [viewUser, setViewUser] = useState(null);
  const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const res = await usersApi.list({ q: opts.q ?? q, ...applied, page: opts.page ?? page, pageSize: PAGE_SIZE });
      setRows(res.rows); setTotal(res.total); setPage(res.page);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, q, applied]);

  useEffect(() => {
    load({ page: 1 });
    api.states().then((r) => setStates(r.states)).catch(() => {});
    if (network) {
      // Only the user types (and their plans) this user may create.
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
    api.managedUsers.list({ pageSize: 100 }).then((r) => setParents(r.rows)).catch(() => {});
    api.services.list({ pageSize: 100, active: true }).then((r) => setServices(r.rows)).catch(() => {});
    api.moduleOptions().then((r) => setModules(r.modules)).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { const t = setTimeout(() => load({ page: 1, q }), 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);
  useEffect(() => { load({ page: 1 }); /* eslint-disable-next-line */ }, [applied]);
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
  const parentOptions = [{ label: '— Self / None —', value: '' }, ...parents.map((p) => ({ label: `${p.user_code} · ${p.name}`, value: p.id }))];
  const employeeOptions = [{ label: '— None —', value: '' }, ...parents.filter((p) => p.user_type_name === 'Employee').map((p) => ({ label: `${p.user_code} · ${p.name}`, value: p.id }))];

  const openAdd = () => { setEditing(null); setF({ ...EMPTY, userTypeId: userTypes[0]?.id ?? '' }); setFormError(null); setView('form'); };
  const openEdit = (r) => {
    setEditing(r);
    setF({
      userTypeId: r.user_type_id, name: r.name || '', fatherHusbandName: r.father_husband_name || '', dob: r.dob || '',
      shopName: r.shop_name || '', email: r.email || '', mobile: r.mobile || '', panNumber: r.pan_number || '',
      aadharNumber: r.aadhar_number || '', gender: r.gender || '', planId: r.plan_id || '', gstNumber: r.gst_number || '',
      minBalance: r.min_balance != null ? String(r.min_balance) : '', password: '',
      address: r.address || '', stateId: r.state_id || '', cityId: r.city_id || '', pincode: r.pincode || '',
      merchantId: r.merchant_id || '', parentId: r.parent_id || '', assignedEmployeeId: r.assigned_employee_id || '',
      serviceAccess: r.service_access || [], moduleAccess: r.module_access || [],
      kycStatus: r.kyc_status, ekycStatus: r.ekyc_status, active: r.is_active,
    });
    setFormError(null); setView('form');
  };

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

  const save = async () => {
    if (f.name.trim().length < 2) { setFormError('Name is required.'); return; }
    if (!/^\d{10}$/.test(f.mobile.trim())) { setFormError('Mobile must be 10 digits.'); return; }
    if (!f.userTypeId) { setFormError('Please select an account type.'); return; }
    if (!editing && f.password.length < 6) { setFormError('Password must be at least 6 characters.'); return; }
    setSaving(true); setFormError(null);
    const body = {
      name: f.name, fatherHusbandName: f.fatherHusbandName, dob: f.dob, shopName: f.shopName, email: f.email, mobile: f.mobile,
      panNumber: f.panNumber, aadharNumber: f.aadharNumber, gender: f.gender, userTypeId: f.userTypeId, planId: f.planId || null,
      gstNumber: f.gstNumber, minBalance: f.minBalance || 0, address: f.address, stateId: f.stateId || null, cityId: f.cityId || null,
      pincode: f.pincode, merchantId: f.merchantId, parentId: f.parentId || null, assignedEmployeeId: f.assignedEmployeeId || null,
      serviceAccess: f.serviceAccess, moduleAccess: f.moduleAccess, isActive: f.active,
    };
    try {
      if (editing) { body.kycStatus = f.kycStatus; body.ekycStatus = f.ekycStatus; await usersApi.update(editing.id, body); }
      else { body.password = f.password; await usersApi.create(body); }
      setView('list'); await load({ page: editing ? page : 1 });
      if (network) loadFilterTypes();
      else api.managedUsers.list({ pageSize: 100 }).then((r) => setParents(r.rows)).catch(() => {});
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  };
  const toggleStatus = async (row) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    try { await usersApi.update(row.id, { isActive: !row.is_active }); }
    catch (e) { setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r))); setError(e.message); }
  };
  const openFund = (row) => { setFundUser(row); setFundAmount(''); setFundType('credit'); setFundPin(''); setFundError(null); };
  const submitFund = async () => {
    const amt = Number(fundAmount);
    if (!Number.isFinite(amt) || amt <= 0) { setFundError('Enter a valid amount.'); return; }
    if (network && !fundPin) { setFundError('Enter your transaction PIN or login password.'); return; }
    setFunding(true); setFundError(null);
    try {
      // Network: a zero-sum transfer from my wallet. Admin: a direct wallet adjustment.
      if (network) await api.network.fundTransfer.create({ userId: fundUser.id, amount: amt, txnType: fundType, transactionPassword: fundPin });
      else await api.managedUsers.fund(fundUser.id, { amount: amt, type: fundType });
      setFundUser(null); await load({ page });
      if (onDone) onDone();
    } catch (e) { setFundError(e.message); } finally { setFunding(false); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.managedUsers.remove(toDelete.id); setToDelete(null); await load({ page: rows.length === 1 && page > 1 ? page - 1 : page }); }
    catch (e) { setError(e.message); } finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1; const to = Math.min(total, page * PAGE_SIZE);

  // ── FORM VIEW ──────────────────────────────────────────────
  if (view === 'form') {
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.formHeaderBar}>
          <Text style={styles.formHeading}>{editing ? `Edit User (${editing.user_code})` : 'Add User'}</Text>
          <Button title="ALL USERS" onPress={() => setView('list')} style={{ paddingHorizontal: 18 }} />
        </View>
        <Card>
          {formError ? <Alert type="error">{formError}</Alert> : null}

          <Text style={styles.section}>Basic Details</Text>
          <View style={styles.grid}>
            {network && editing ? (
              <View style={styles.field}><Text style={styles.label}>Account Type</Text><Text style={[styles.input, { color: colors.muted }]}>{editing.user_type_name}</Text></View>
            ) : (
              <View style={styles.field}><Select label="Select Account Type *" value={f.userTypeId} options={utOptions} onChange={(v) => { set('userTypeId', v); set('planId', ''); }} placeholder="-- Choose --" /></View>
            )}
            <Field label="Name *" value={f.name} onChange={(v) => set('name', v)} placeholder="Full name" />
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
            <Text style={styles.hint}>{editing ? `${editing.user_code} stays in your network.` : 'The new user is placed directly under you.'} Their KYC, service access and merchant ID are set by the admin.</Text>
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
              <View style={styles.field}><Select label="Parent Id" value={f.parentId} options={parentOptions} onChange={(v) => set('parentId', v)} placeholder="-- Self / None --" /></View>
            )}
            <View style={styles.field}><Select label="Assigned Employee" value={f.assignedEmployeeId} options={employeeOptions} onChange={(v) => set('assignedEmployeeId', v)} placeholder="-- None --" /></View>
          </View>

          <View style={styles.sectionRow}>
            <Text style={styles.section}>Service Access</Text>
            <Pressable onPress={() => toggleAll('serviceAccess', allServiceIds)}><Text style={styles.checkAll}>{(f.serviceAccess || []).length === allServiceIds.length && allServiceIds.length ? 'Uncheck All' : 'Check All'}</Text></Pressable>
          </View>
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

          <View style={styles.formActions}>
            <Button title="Cancel" variant="ghost" onPress={() => setView('list')} style={{ minWidth: 120 }} />
            <Button title={editing ? 'Save' : 'Create User'} onPress={save} loading={saving} style={{ minWidth: 150 }} />
          </View>
        </Card>
      </View>
    );
  }

  // ── LIST VIEW ──────────────────────────────────────────────
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.topBar}>
        <Text style={styles.foundText}>{total} User{total === 1 ? '' : 's'} Found</Text>
        <Button title="+ ADD NEW" onPress={openAdd} style={{ paddingHorizontal: 20 }} />
      </View>

      <Card>
        <View style={styles.grid}>
          <View style={styles.field}><Select label="User Type" value={fUserType} options={utFilterOptions} onChange={setFUserType} placeholder="All" /></View>
          <Field label="Parent User" value={fParent} onChange={setFParent} placeholder="Parent code / name" />
          <View style={styles.field}><Select label="Account Status" value={fAccount} options={ACCOUNT_OPTIONS} onChange={setFAccount} searchable={false} /></View>
          <View style={styles.field}><Select label="KYC Status" value={fKyc} options={KYC_OPTIONS} onChange={setFKyc} searchable={false} /></View>
          <View style={[styles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={applyFilters} /></View>
        </View>
      </Card>

      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>View All Users</Text>
          <View style={styles.searchWrap}><Text style={styles.searchLabel}>Search:</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Name, shop, mobile, id…" placeholderTextColor={colors.muted} style={styles.search} /></View>
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: 1690, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.cell, styles.cNo, styles.thText]}>#</Text>
              <Text style={[styles.cell, styles.cWide, styles.thText]}>Shop Name</Text>
              <Text style={[styles.cell, styles.cWide, styles.thText]}>Name</Text>
              <Text style={[styles.cell, styles.cMob, styles.thText]}>Mobile</Text>
              <Text style={[styles.cell, styles.cId, styles.thText]}>User Id</Text>
              <Text style={[styles.cell, styles.cType, styles.thText]}>User Type</Text>
              <Text style={[styles.cell, styles.cEmail, styles.thText]}>Email Id</Text>
              <Text style={[styles.cell, styles.cWallet, styles.thText]}>Wallet</Text>
              <Text style={[styles.cell, styles.cPlan, styles.thText]}>Plan</Text>
              <Text style={[styles.cell, styles.cDate, styles.thText]}>Join Date</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cParent, styles.thText]}>Parent Id</Text>
              <Text numberOfLines={1} style={[styles.cell, styles.cCreated, styles.thText]}>Created By</Text>
              <Text style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
              <Text style={[styles.cell, styles.cKyc, styles.thText]}>E-Kyc</Text>
              <Text style={[styles.cell, styles.cKyc, styles.thText]}>Kyc</Text>
              <Text style={[styles.cell, styles.cAction, styles.thText]}>Action</Text>
            </View>
            {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={styles.empty}><Text style={{ color: colors.muted }}>No users found.</Text></View>
                : rows.map((row, i) => (
                  <View key={row.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                    <Text style={[styles.cell, styles.cNo, styles.td]}>{from + i}</Text>
                    <Text style={[styles.cell, styles.cWide, styles.td]}>{row.shop_name || '—'}</Text>
                    <Text style={[styles.cell, styles.cWide, styles.td]}>{row.name}</Text>
                    <Text style={[styles.cell, styles.cMob, styles.td]}>{row.mobile}</Text>
                    <Text style={[styles.cell, styles.cId, styles.td]}>{row.user_code}</Text>
                    <Text style={[styles.cell, styles.cType, styles.td]}>{row.user_type_name}</Text>
                    <Text style={[styles.cell, styles.cEmail, styles.td]} numberOfLines={1}>{row.email || '—'}</Text>
                    <Text style={[styles.cell, styles.cWallet, styles.td]}>{money(row.wallet_balance)}</Text>
                    <Text style={[styles.cell, styles.cPlan, styles.td]}>{row.plan_name || '—'}</Text>
                    <Text style={[styles.cell, styles.cDate, styles.td]}>{fmtDate(row.join_date)}</Text>
                    <Text style={[styles.cell, styles.cParent, styles.td]}>{row.parent_code || '—'}</Text>
                    <View style={[styles.cell, styles.cCreated]}><Text style={styles.td} numberOfLines={1}>{row.created_by_code || '—'}</Text>{row.created_by_name ? <Text style={styles.sub} numberOfLines={1}>{row.created_by_name}</Text> : null}</View>
                    <View style={[styles.cell, styles.cStatus]}><Switch value={!!row.is_active} onValueChange={() => toggleStatus(row)} trackColor={{ true: colors.success, false: '#cbd5e1' }} thumbColor="#fff" /></View>
                    <View style={[styles.cell, styles.cKyc]}><KycBadge value={row.ekyc_status} /></View>
                    <View style={[styles.cell, styles.cKyc]}><KycBadge value={row.kyc_status} /></View>
                    <View style={[styles.cell, styles.cAction, styles.actions]}>
                      {/* In the network panel money moves only to users directly under you. */}
                      {!network || row.parent_id === meId ? <Pressable onPress={() => openFund(row)} hitSlop={6}><Text style={{ fontSize: 15 }}>💰</Text></Pressable> : null}
                      <Pressable onPress={() => setViewUser(row)} hitSlop={6}><Text style={{ fontSize: 15 }}>👁️</Text></Pressable>
                      <Pressable onPress={() => openEdit(row)} hitSlop={6}><Text style={{ color: colors.primary, fontSize: 15 }}>✏️</Text></Pressable>
                      {!network ? <Pressable onPress={() => setToDelete(row)} hitSlop={6}><Text style={{ color: colors.danger, fontSize: 15 }}>🗑️</Text></Pressable> : null}
                    </View>
                  </View>
                ))}
          </View>
        </ScrollView>
        <View style={styles.pagination}>
          <Text style={styles.entries}>Showing {from} to {to} of {total} entries</Text>
          <View style={styles.pager}>
            <Pressable disabled={page <= 1} onPress={() => load({ page: page - 1 })} style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Previous</Text></Pressable>
            <View style={[styles.pageBtn, styles.pageCurrent]}><Text style={{ color: '#fff', fontWeight: '700' }}>{page}</Text></View>
            <Pressable disabled={page >= totalPages} onPress={() => load({ page: page + 1 })} style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}><Text style={styles.pageBtnText}>Next</Text></Pressable>
          </View>
        </View>
      </Card>

      {/* Fund modal */}
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
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  foundText: { fontSize: 18, fontWeight: '700', color: colors.text },
  formHeaderBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
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
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, minWidth: 200, color: colors.text, outlineStyle: 'none' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.text, outlineStyle: 'none' },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  trAlt: { backgroundColor: '#f8fafc' },
  th: { backgroundColor: colors.primary, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  thText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  cell: { paddingVertical: 12, paddingHorizontal: 8 },
  td: { color: colors.text, fontSize: 13 },
  sub: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  cNo: { width: 36 }, cWide: { width: 130 }, cMob: { width: 105 }, cId: { width: 90 }, cType: { width: 110 }, cEmail: { width: 180 }, cWallet: { width: 80 }, cPlan: { width: 120 }, cDate: { width: 110 }, cParent: { width: 100 }, cCreated: { width: 130 }, cStatus: { width: 70 }, cKyc: { width: 85 }, cAction: { width: 130 },
  actions: { flexDirection: 'row', gap: 12 },
  detailRow: { flexDirection: 'row', paddingVertical: 5 },
  detailLabel: { width: 130, color: colors.muted, fontSize: 13 },
  detailValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 14 },
  empty: { padding: 30, alignItems: 'center' },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  entries: { color: colors.muted, fontSize: 13 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  pageBtnDisabled: { opacity: 0.5 }, pageBtnText: { color: colors.text }, pageCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 22, width: '100%', maxWidth: 420, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  para: { color: colors.text, lineHeight: 21 },
  typeBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  typeBtnOn: { backgroundColor: colors.success, borderColor: colors.success },
  typeBtnOnRed: { backgroundColor: colors.danger, borderColor: colors.danger },
  typeText: { color: colors.text, fontWeight: '600' },
  typeOnText: { color: '#fff', fontWeight: '700' },
});
