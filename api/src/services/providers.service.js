'use strict';

const env = require('../config/env');

/**
 * External-service provider adapters. Selected by APP_MODE (default 'mock') —
 * never inferred from a key. Mock adapters return deterministic responses (plus
 * a couple of seeded failures) so the whole retailer panel demos with ZERO
 * credentials. Live adapters are stubs that throw PROVIDER_NOT_CONFIGURED until
 * wired to a licensed provider. Mirrors services/kyc.service.js.
 */
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const ref = (p) => `${p}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
const notConfigured = () => { throw err(503, 'PROVIDER_NOT_CONFIGURED', 'Live provider is not configured. Add credentials to enable live mode.'); };

// A tiny deterministic "decline" trigger so failure paths are testable: amount === 1.
const decline = (amount) => { if (Number(amount) === 1) throw err(402, 'PROVIDER_DECLINED', 'Transaction declined by operator'); };

const mock = {
  mode: 'mock',
  recharge: {
    async plans() {
      const mk = (price, desc) => ({ circle: 'Delhi NCR', validity: 'N/A', price, desc });
      return {
        tabs: [
          { key: 'TOPUP', plans: [mk(10, 'Talktime ₹7.47'), mk(20, 'Talktime ₹14.95'), mk(50, 'Talktime ₹39.37')] },
          { key: 'FULLTT', plans: [mk(179, '2GB/day, 24 days'), mk(299, '2GB/day, 28 days')] },
          { key: '3G/4G', plans: [mk(19, '1GB data'), mk(49, '3GB data')] },
        ],
      };
    },
    async dthInfo() {
      return { currentBalance: 461.44, name: 'Gaurav Singh', nextRechargeDate: '2026-10-01', status: 'Active', planName: 'HD Value Pack' };
    },
    async recharge({ amount }) { decline(amount); return { ref: ref('RCH'), status: 'success' }; },
  },
  bbps: {
    async fetchBill({ operator }) {
      return { name: 'Consumer Name', billNumber: `B${ref('')}`, amount: 1548, dueDate: '2026-10-11', billDate: '2026-09-20', operator };
    },
    async pay({ amount }) { decline(amount); return { ref: ref('BBP'), status: 'success' }; },
  },
  aeps: {
    async devices() { return { devices: ['Morpho', 'Mantra', 'Startek', 'Secugen'] }; },
    async transact({ txnType, amount }) {
      if (txnType === 'withdrawal') decline(amount);
      const base = { ref: ref('AEPS'), rrn: `${Date.now()}`.slice(-12), ack: String(Math.floor(Math.random() * 9000 + 1000)), status: 'success', bankName: 'Airtel Payment Bank' };
      if (txnType === 'balance') return { ...base, currentBalance: 24287.44 };
      if (txnType === 'mini') return { ...base, statement: [{ date: '2026-09-15', amt: -500, desc: 'ATM WDL' }, { date: '2026-09-12', amt: 12000, desc: 'SAL CR' }] };
      return { ...base, withdrawn: amount };
    },
  },
  dmt: {
    async registerSender({ mobile }) { return { name: 'Registered Sender', kycStatus: 'verified', mobile }; },
    async verifyBeneficiary({ name }) { return { verified: true, name: name || 'VERIFIED NAME' }; },
    async transfer({ amount }) { decline(amount); return { ref: ref('DMT'), utr: ref('UTR'), status: 'success' }; },
  },
  booking: {
    async search(type) {
      if (type === 'flight') return { results: [{ id: 'F1', from: 'DEL', to: 'BOM', depart: '06:00', arrive: '08:10', airline: 'IndiGo', price: 4120 }, { id: 'F2', from: 'DEL', to: 'BOM', depart: '11:30', arrive: '13:45', airline: 'Air India', price: 4890 }] };
      if (type === 'hotel') return { results: [{ id: 'H1', name: 'City Grand', city: 'Mumbai', price: 3200 }, { id: 'H2', name: 'Sea View Inn', city: 'Mumbai', price: 2600 }] };
      return { results: [{ id: 'B1', operator: 'VRL Travels', from: 'DEL', to: 'JAI', depart: '22:00', price: 850 }] };
    },
    async book({ amount }) { decline(amount); return { pnr: ref('PNR'), ref: ref('BKG'), status: 'booked' }; },
  },
};

const live = {
  mode: 'live',
  recharge: { plans: notConfigured, dthInfo: notConfigured, recharge: notConfigured },
  bbps: { fetchBill: notConfigured, pay: notConfigured },
  aeps: { devices: notConfigured, transact: notConfigured },
  dmt: { registerSender: notConfigured, verifyBeneficiary: notConfigured, transfer: notConfigured },
  booking: { search: notConfigured, book: notConfigured },
};

const providers = env.isLive ? live : mock;
providers.err = err;
module.exports = providers;
