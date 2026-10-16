'use strict';

const db = require('../config/db');
const serviceRepo = require('../repositories/service.repo');

// What a service's "operator" can be: an operator from the operators master, or the transfer mode for
// money services. Services not listed here have no choice (all operators only). Used by Commission Slots
// and by API Management (SP Keys), so both offer the same names the transactions carry.
const OPERATOR_SOURCES = {
  'mobile recharge': { service: 'mobile' },
  'dth recharge': { service: 'dth' },
  'bill payment': { service: 'bbps' },
  'lic payment': { service: 'bbps', category: 'Insurance' },
  'fastag recharge': { service: 'fastag' },
  'gas booking': { service: 'gas' },
  'money transfer': { modes: ['IMPS', 'NEFT'] },
  'move to bank': { modes: ['IMPS', 'NEFT'] },
};

/** { kind: 'operator'|'mode'|null, options: [names] } for a service id. */
async function operatorOptions(serviceId) {
  const svc = serviceId ? await serviceRepo.findById(serviceId) : null;
  const src = svc && OPERATOR_SOURCES[String(svc.title).trim().toLowerCase()];
  if (!src) return { kind: null, options: [] };
  if (src.modes) return { kind: 'mode', options: src.modes };
  const q = db('operators').where({ is_active: true, service: src.service });
  if (src.category) q.where({ category: src.category });
  return { kind: 'operator', options: (await q.orderBy('name').select('name')).map((r) => r.name) };
}

module.exports = { OPERATOR_SOURCES, operatorOptions };
