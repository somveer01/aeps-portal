'use strict';

const db = require('../config/db');
const { computeAmounts, rateOf } = require('../services/commission.service');
const { operatorOptions } = require('../services/operatorOptions');
const { toAmount, round2 } = require('../utils/money');

/*
 * Commission Overview (admin, read only): for every service and operator, what the API pays the company and what each level of a sale
 * chain (Super Distributor -> Distributor -> Retailer ...) is paid, plus the company's margin - on a sample amount. It reads the same
 * tables the commission engine reads and applies the same rules (services/commission.service.js findSlab / resolveShares /
 * providerCommissionFor), so what it shows is what a real transaction of that amount would do. Editing is done with the ordinary
 * Commission Slots endpoints; nothing here writes.
 *
 *  - Chain: the type that did the sale ("bottom") and every type above it in User Type Master. The bottom type is paid by its own slab
 *    (self or chain); each type above is paid only by a 'chain' slab. All are credit slabs of ONE plan per type (the plan is chosen).
 *  - Provider: the API's SP key row for the service (exact operator, else all operators) on the API that Product Switch routes the service to
 *    (the Mock API when it has no route), else the Service Master rate - exactly providerCommissionFor.
 *  - Each paid share is commission + GST (the engine pays "net"); margin = provider commission + service charge collected - total paid.
 */
const lc = (v) => String(v == null ? '' : v).trim().toLowerCase();
const SAMPLE = 1000;
const MAX_AMOUNT = 10000000;

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

// The slab a type earns on this service / operator / amount: operator-specific beats all-operators, then the oldest (findSlab's order).
function pickSlab(slabs, { operator, amount, bottom, txnType }) {
  const op = lc(operator);
  const fits = slabs.filter((s) => s.txn_type === txnType && Number(s.min_amount) <= amount && Number(s.max_amount) >= amount
    && (txnType === 'debit' || bottom || s.chain_type === 'chain')
    && (lc(s.operator) === '' || (op && lc(s.operator) === op)));
  fits.sort((a, b) => (lc(a.operator) !== '' ? 0 : 1) - (lc(b.operator) !== '' ? 0 : 1) || a.id - b.id);
  return fits[0] || null;
}

// GET /api/commission-overview?amount=1000&typeId=<type that did the sale>&plans=<typeId>:<planId>,...
async function overview(req, res, next) {
  try {
    const amount = req.query.amount === undefined || req.query.amount === '' ? SAMPLE : toAmount(req.query.amount);
    if (!(amount > 0) || amount > MAX_AMOUNT) return res.status(400).json({ error: 'Enter a sample amount (up to 2 decimals, at most 1,00,00,000)', code: 'INVALID_AMOUNT' });

    const types = typeDepths(await db('user_types').orderBy('id').select('id', 'name', 'parent_type_id'));
    const typeById = new Map(types.map((t) => [t.id, t]));
    const plans = await db('plans').where({ is_active: true }).orderBy('id').select('id', 'name', 'user_type_id');
    const slotsAll = await db('commission_slots').where({ is_active: true }).whereRaw("coalesce(trim(specific_user), '') = ''")
      .select('id', 'user_type_id', 'service_id', 'plan_id', 'operator', 'commission_type', 'min_amount', 'max_amount', 'value', 'chain_type', 'txn_type');

    // The type that did the sale: asked for, else the deepest type that has a slab, else the deepest type.
    let bottomId = parseInt(req.query.typeId, 10);
    if (!typeById.has(bottomId)) {
      const withSlabs = types.filter((t) => slotsAll.some((s) => s.user_type_id === t.id)).sort((a, b) => b.depth - a.depth || a.id - b.id);
      bottomId = (withSlabs[0] || [...types].sort((a, b) => b.depth - a.depth || a.id - b.id)[0] || {}).id;
    }
    if (!bottomId) return res.json({ amount, types, bottomTypeId: null, chain: [], services: [] });

    // Chain top -> bottom.
    const chainTypes = []; const seenT = new Set();
    for (let t = typeById.get(bottomId); t && !seenT.has(t.id); t = t.parentTypeId ? typeById.get(t.parentTypeId) : null) { seenT.add(t.id); chainTypes.unshift(t); }
    const wanted = parsePlans(req.query.plans);
    const chain = chainTypes.map((t) => {
      const own = plans.filter((p) => p.user_type_id === t.id);
      const chosen = own.find((p) => p.id === wanted.get(t.id)) || own[0] || null;
      return { typeId: t.id, name: t.name, depth: t.depth, planId: chosen ? chosen.id : null, planName: chosen ? chosen.name : null, plans: own.map((p) => ({ id: p.id, name: p.name })) };
    });

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
      const svcSlots = slotsAll.filter((s) => s.service_id === svc.id);
      const providerId = routes.get(svc.id) || (mock && mock.id) || null;
      const svcProducts = products.filter((p) => p.service_id === svc.id && p.provider_id === providerId);

      // Operators: all, the service's own list, and any operator named by a slab or an SP key (so nothing is hidden).
      const names = ['']; const seen = new Set(['']);
      [...opts.options, ...svcSlots.map((s) => s.operator), ...svcProducts.map((p) => p.operator)].forEach((n) => {
        const k = lc(n); if (k && !seen.has(k)) { seen.add(k); names.push(String(n).trim()); }
      });

      const rows = names.map((operator) => {
        // Provider commission (the engine's providerCommissionFor).
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

        // One cell per type of the chain.
        let totalNet = 0; let gap = false; let any = false;
        const cells = chain.map((c, i) => {
          const bottom = i === chain.length - 1;
          const own = svcSlots.filter((s) => s.user_type_id === c.typeId && s.plan_id === c.planId);
          const credit = own.filter((s) => s.txn_type === 'credit');
          const slab = c.planId ? pickSlab(own, { operator, amount, bottom, txnType: 'credit' }) : null;
          const cell = { typeId: c.typeId, planId: c.planId, slotId: null, others: credit.length };
          if (slab) {
            const a = computeAmounts({ commissionType: slab.commission_type, value: slab.value, amount });
            Object.assign(cell, {
              slotId: slab.id, commissionType: slab.commission_type, value: Number(slab.value), chainType: slab.chain_type, operator: slab.operator || '',
              inherited: !!operator && lc(slab.operator) === '', minAmount: Number(slab.min_amount), maxAmount: Number(slab.max_amount),
              commission: a.commission, gst: a.gst, net: a.net,
            });
            totalNet += a.net; any = true; cell.others = credit.length - 1;
          } else if (!bottom) gap = true;
          return cell;
        });
        const chargeSlab = chain[chain.length - 1].planId
          ? pickSlab(svcSlots.filter((s) => s.user_type_id === chain[chain.length - 1].typeId && s.plan_id === chain[chain.length - 1].planId), { operator, amount, bottom: true, txnType: 'debit' }) : null;
        const charge = chargeSlab ? computeAmounts({ commissionType: chargeSlab.commission_type, value: chargeSlab.value, amount }).net : 0;
        const margin = round2(providerAmount + charge - totalNet);
        let status = 'ok';
        if (margin < 0) status = 'over'; else if (any && gap) status = 'gap'; else if (!any && providerAmount === 0) status = 'empty';
        return {
          operator, label: operator || 'All operators',
          provider: { amount: providerAmount, percent: round2((providerAmount / amount) * 100), source, apiName: provider ? provider.name : null, type: rateType, value: rateValue, apiOn: provider ? !!provider.is_active : null },
          cells, totalPaid: round2(totalNet), totalPaidPercent: round2((totalNet / amount) * 100),
          charge: round2(charge), margin, marginPercent: round2((margin / amount) * 100), status,
        };
      });
      out.push({ serviceId: svc.id, service: svc.title, code: svc.code, screen: svc.screen, isActive: !!svc.is_active, category: svc.category_name, operatorKind: opts.kind, rows });
    }
    return res.json({ amount, types, bottomTypeId: bottomId, chain, services: out });
  } catch (e) { return next(e); }
}

module.exports = { overview };
