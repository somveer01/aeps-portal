'use strict';

const db = require('../config/db');
const { computeAmounts, rateOf, selectSlab, MAX_CHAIN_LEVELS } = require('./commission.service');
const { operatorOptions } = require('./operatorOptions');
const { round2 } = require('../utils/money');

/*
 * Commission Overview (read only). For every service and operator: what the API pays the company, what each level of a sale chain is
 * paid and the company's margin, on a sample amount. It reads the tables the commission engine reads and applies its rules
 * (commission.service.js selectSlab = findSlab in memory, rateOf / providerCommissionFor for the API's rate), so what it shows is what
 * a real transaction of that amount would do. Editing is done with the ordinary Commission Slots endpoints; nothing here writes.
 *
 * Two ways to pick the chain (both end in the same rows):
 *   by TYPE  - the user type that did the sale and every type above it in User Type Master, one plan per type. Shows the type-level
 *              slabs (a user-specific slab is not applied here, only counted).
 *   by USER  - one user and the real chain above him (parent_id, up to MAX_CHAIN_LEVELS), each with his own plan. A slab written for one
 *              user (specific_user) beats the type's slab, exactly as in a real sale. Also shows what the user earns on his DOWNLINE's
 *              sales (his chain slab) and the commission package each member holds.
 * The bottom of the chain is paid by its own slab (self or chain); every level above only by a 'chain' slab. Each paid share is
 * commission + GST; margin = API commission + service charge collected - everything paid. Packages move share between a child and its
 * parent but never change the total, so they are shown, not counted.
 */
const lc = (v) => String(v == null ? '' : v).trim().toLowerCase();

function typeDepths(types) {
  const byId = new Map(types.map((t) => [t.id, t]));
  return types.map((t) => {
    let depth = 1; let p = t.parent_type_id; const seen = new Set([t.id]);
    while (p && byId.has(p) && !seen.has(p)) { seen.add(p); depth += 1; p = byId.get(p).parent_type_id; }
    return { id: t.id, name: t.name, parentTypeId: t.parent_type_id || null, depth };
  });
}

// "3:7,4:9" -> Map(3 -> 7, 4 -> 9)
function parsePlans(raw) {
  const out = new Map();
  String(raw || '').split(',').forEach((pair) => {
    const m = /^(\d{1,9}):(\d{1,9})$/.exec(pair.trim());
    if (m) out.set(parseInt(m[1], 10), parseInt(m[2], 10));
  });
  return out;
}

// ── chains ───────────────────────────────────────────────────────────────────────
// A chain is [{ key, typeId, typeName, planId, planName, plans, userId, userCode, userName, packageId }], top level first, the one that
// did the sale last.

function chainByType({ types, plans, bottomId, wanted }) {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const list = []; const seen = new Set();
  for (let t = typeById.get(bottomId); t && !seen.has(t.id); t = t.parentTypeId ? typeById.get(t.parentTypeId) : null) { seen.add(t.id); list.unshift(t); }
  return list.map((t) => {
    const own = plans.filter((p) => p.user_type_id === t.id);
    const chosen = own.find((p) => p.id === wanted.get(t.id)) || own[0] || null;
    return {
      key: `t${t.id}`, typeId: t.id, typeName: t.name, planId: chosen ? chosen.id : null, planName: chosen ? chosen.name : null,
      plans: own.map((p) => ({ id: p.id, name: p.name })), userId: null, userCode: null, userName: null, packageId: null,
    };
  });
}

async function chainByUser(userId) {
  const cols = ['u.id', 'u.user_code', 'u.username', 'u.full_name', 'u.user_type_id', 'u.plan_id', 'u.parent_id', 'u.commission_package_id', 'u.is_active', 't.name as type_name', 'p.name as plan_name'];
  const load = (id) => db('users as u').leftJoin('user_types as t', 't.id', 'u.user_type_id').leftJoin('plans as p', 'p.id', 'u.plan_id')
    .where('u.id', id).whereNotNull('u.user_type_id').first(cols);
  const me = await load(userId);
  if (!me) return null;
  const list = [me]; const seen = new Set([me.id]);
  for (let parent = me.parent_id; parent && list.length <= MAX_CHAIN_LEVELS && !seen.has(parent);) {
    // eslint-disable-next-line no-await-in-loop
    const u = await load(parent);
    if (!u) break;
    seen.add(u.id); list.unshift(u); parent = u.parent_id;
  }
  return list.map((u) => ({
    key: `u${u.id}`, typeId: u.user_type_id, typeName: u.type_name, planId: u.plan_id || null, planName: u.plan_name || null, plans: [],
    userId: u.id, userCode: u.user_code || u.username, userName: u.full_name, packageId: u.commission_package_id || null, isActive: !!u.is_active,
  }));
}

// ── one cell, one row ───────────────────────────────────────────────────────────────
function cellFor(col, slabs, { operator, amount, bottom, chainOnly }) {
  const mine = slabs.filter((s) => s.user_type_id === col.typeId && (!col.planId || s.plan_id === col.planId));
  const generic = mine.filter((s) => lc(s.specific_user) === '' && s.txn_type === 'credit');
  const forUser = col.userCode ? mine.filter((s) => lc(s.specific_user) === lc(col.userCode)).length : 0;
  const slab = selectSlab(slabs, {
    userTypeId: col.typeId, planId: col.planId, userCode: col.userCode, operator, amount, chainOnly: chainOnly !== undefined ? chainOnly : !bottom, creditOnly: true,
  });
  const cell = {
    key: col.key, typeId: col.typeId, planId: col.planId, slotId: null, others: generic.length,
    userSlabs: col.userCode ? forUser : mine.filter((s) => lc(s.specific_user) !== '' && s.txn_type === 'credit').length,
  };
  if (!slab) return cell;
  const a = computeAmounts({ commissionType: slab.commission_type, value: slab.value, amount });
  Object.assign(cell, {
    slotId: slab.id, commissionType: slab.commission_type, value: Number(slab.value), chainType: slab.chain_type, operator: slab.operator || '',
    scope: lc(slab.specific_user) !== '' ? 'user' : 'type', specificUser: slab.specific_user || '',
    inherited: !!operator && lc(slab.operator) === '', minAmount: Number(slab.min_amount), maxAmount: Number(slab.max_amount),
    commission: a.commission, gst: a.gst, net: a.net,
  });
  if (cell.scope === 'type') cell.others = Math.max(0, generic.length - 1);
  if (cell.scope === 'user') {
    // The slab underneath (what everyone of his type and plan gets), so a screen can change THAT one instead of his own.
    const under = selectSlab(slabs, { userTypeId: col.typeId, planId: col.planId, userCode: null, operator, amount, chainOnly: chainOnly !== undefined ? chainOnly : !bottom, creditOnly: true });
    if (under) {
      const u = computeAmounts({ commissionType: under.commission_type, value: under.value, amount });
      cell.base = { slotId: under.id, commissionType: under.commission_type, value: Number(under.value), chainType: under.chain_type, inherited: !!operator && lc(under.operator) === '', minAmount: Number(under.min_amount), maxAmount: Number(under.max_amount), net: u.net };
    }
  }
  return cell;
}

function packageFor(items, operator) {
  const mine = items;
  return mine.find((i) => operator && lc(i.operator) === lc(operator)) || mine.find((i) => lc(i.operator) === '') || null;
}

async function buildOverview({ amount, typeId, plansParam, userId }) {
  const types = typeDepths(await db('user_types').orderBy('id').select('id', 'name', 'parent_type_id'));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const plans = await db('plans').where({ is_active: true }).orderBy('id').select('id', 'name', 'user_type_id');
  const slotsAll = await db('commission_slots').where({ is_active: true })
    .select('id', 'user_type_id', 'service_id', 'plan_id', 'operator', 'specific_user', 'commission_type', 'min_amount', 'max_amount', 'value', 'chain_type', 'txn_type', 'is_active');

  let chain; let mode = 'type'; let user = null; let bottomId = null;
  if (userId) {
    chain = await chainByUser(userId);
    if (!chain) return { error: 'User not found', code: 'NOT_FOUND', status: 404 };
    mode = 'user'; const me = chain[chain.length - 1];
    user = { id: me.userId, userCode: me.userCode, name: me.userName, typeId: me.typeId, typeName: me.typeName, planId: me.planId, planName: me.planName, isActive: me.isActive };
    bottomId = me.typeId;
  } else {
    bottomId = typeId;
    if (!typeById.has(bottomId)) {
      const withSlabs = types.filter((t) => slotsAll.some((s) => s.user_type_id === t.id)).sort((a, b) => b.depth - a.depth || a.id - b.id);
      bottomId = (withSlabs[0] || [...types].sort((a, b) => b.depth - a.depth || a.id - b.id)[0] || {}).id;
    }
    if (!bottomId) return { amount, mode, types, bottomTypeId: null, chain: [], services: [] };
    chain = chainByType({ types, plans, bottomId, wanted: parsePlans(plansParam) });
  }
  const last = chain.length - 1;

  // The package each member holds (by user mode): owned by his parent, made for his type, active.
  const packageItems = new Map(); // childUserId -> items by service
  if (mode === 'user') {
    for (let i = 1; i < chain.length; i += 1) {
      const child = chain[i];
      if (!child.packageId) continue;
      // eslint-disable-next-line no-await-in-loop
      const pk = await db('commission_packages').where({ id: child.packageId, owner_user_id: chain[i - 1].userId, user_type_id: child.typeId, is_active: true }).first('id', 'name');
      if (!pk) continue;
      // eslint-disable-next-line no-await-in-loop
      const items = await db('commission_package_items').where({ package_id: pk.id }).select('service_id', 'operator', 'commission_type', 'value');
      packageItems.set(child.userId, { name: pk.name, items });
    }
  }

  // Provider side.
  const providers = await db('api_providers').select('id', 'code', 'name', 'is_active');
  const mock = providers.find((p) => p.code === 'MOCK') || null;
  const providerById = new Map(providers.map((p) => [p.id, p]));
  const routes = new Map((await db('service_routes').select('service_id', 'provider_id')).map((r) => [r.service_id, r.provider_id]));
  const products = await db('provider_products').where({ is_active: true }).select('provider_id', 'service_id', 'operator', 'sp_key', 'commission_type', 'commission_value');
  const services = await db('services as s').leftJoin('service_categories as c', 'c.id', 's.service_category_id')
    .orderBy('c.name').orderBy('s.title')
    .select('s.id', 's.title', 's.code', 's.screen', 's.is_active', 's.provider_commission_type', 's.provider_commission_value', 'c.name as category_name');

  const out = [];
  for (const svc of services) {
    // eslint-disable-next-line no-await-in-loop
    const opts = await operatorOptions(svc.id);
    const slabs = slotsAll.filter((s) => s.service_id === svc.id);
    const providerId = routes.get(svc.id) || (mock && mock.id) || null;
    const svcProducts = products.filter((p) => p.service_id === svc.id && p.provider_id === providerId);

    // Operators: all, the service's own list, and any operator named by a slab or an SP key (so nothing is hidden).
    const names = ['']; const seen = new Set(['']);
    [...opts.options, ...slabs.map((s) => s.operator), ...svcProducts.map((p) => p.operator)].forEach((n) => {
      const k = lc(n); if (k && !seen.has(k)) { seen.add(k); names.push(String(n).trim()); }
    });

    const rows = names.map((operator) => {
      // The API's commission (the engine's providerCommissionFor).
      const product = (operator && svcProducts.find((p) => lc(p.operator) === lc(operator))) || svcProducts.find((p) => lc(p.operator) === '') || null;
      let providerAmount; let source; let rateType; let rateValue;
      if (product) {
        providerAmount = rateOf(product, amount); source = 'sp_key'; rateType = product.commission_type; rateValue = Number(product.commission_value);
      } else {
        const v = Number(svc.provider_commission_value || 0);
        providerAmount = round2(svc.provider_commission_type === 'amount' ? v : (amount * v) / 100);
        source = v ? 'service' : 'none'; rateType = svc.provider_commission_type; rateValue = v;
      }
      const provider = providerById.get(providerId);

      let totalNet = 0; let gap = false; let any = false;
      const cells = chain.map((col, i) => {
        const cell = cellFor(col, slabs, { operator, amount, bottom: i === last });
        if (cell.slotId) { totalNet += cell.net; any = true; } else if (i !== last) gap = true;
        const pk = packageItems.get(col.userId);
        if (pk) {
          const item = packageFor(pk.items.filter((x) => x.service_id === svc.id), operator);
          if (item) cell.package = { name: pk.name, commissionType: item.commission_type, value: Number(item.value), ...computeAmounts({ commissionType: item.commission_type, value: item.value, amount }) };
        }
        return cell;
      });
      // The service charge the bottom of the chain pays (a debit slab).
      const bottom = chain[last];
      const chargeSlab = bottom.planId || mode === 'user'
        ? selectSlab(slabs, { userTypeId: bottom.typeId, planId: bottom.planId, userCode: bottom.userCode, operator, amount, txnType: 'debit' }) : null;
      const charge = chargeSlab ? computeAmounts({ commissionType: chargeSlab.commission_type, value: chargeSlab.value, amount }).net : 0;
      const margin = round2(providerAmount + charge - totalNet);
      let status = 'ok';
      if (margin < 0) status = 'over'; else if (any && gap) status = 'gap'; else if (!any && providerAmount === 0) status = 'empty';
      const row = {
        operator, label: operator || 'All operators',
        provider: { amount: providerAmount, percent: round2((providerAmount / amount) * 100), source, apiName: provider ? provider.name : null, type: rateType, value: rateValue, apiOn: provider ? !!provider.is_active : null },
        cells, totalPaid: round2(totalNet), totalPaidPercent: round2((totalNet / amount) * 100),
        charge: round2(charge), margin, marginPercent: round2((margin / amount) * 100), status,
      };
      // User mode: what the selected user earns when someone BELOW him sells (his chain slab), which can differ from his own-sale slab.
      if (mode === 'user') row.asUpline = cellFor(chain[last], slabs, { operator, amount, bottom: false, chainOnly: true });
      return row;
    });
    out.push({ serviceId: svc.id, service: svc.title, code: svc.code, screen: svc.screen, isActive: !!svc.is_active, category: svc.category_name, operatorKind: opts.kind, rows });
  }
  return { amount, mode, user, types, bottomTypeId: bottomId, chain, services: out };
}

module.exports = { buildOverview, typeDepths, parsePlans };
