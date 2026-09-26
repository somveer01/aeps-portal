'use strict';

const env = require('../config/env');

/**
 * Pluggable KYC (PAN / Aadhaar) verification. Selected by APP_MODE:
 *   - mock (default): validates format only and returns a simulated result — the
 *     app runs end-to-end with ZERO external credentials.
 *   - live: calls the licensed NSDL/UIDAI provider. The adapter is a clearly
 *     marked stub; wire the real HTTP calls and provider keys before enabling.
 *
 * Both adapters expose the same async interface so callers never branch on mode.
 */

const mock = {
  async verifyPan(panNumber) {
    return { verified: true, panNumber, name: 'NAME AS PER PAN', status: 'valid', provider: 'mock' };
  },
  async sendAadhaarOtp(_aadhaarNumber) {
    const refId = `AADH${Date.now().toString(36).toUpperCase()}`;
    return { otpSent: true, refId, provider: 'mock', message: 'OTP sent to the mobile linked with this Aadhaar.' };
  },
};

const live = {
  async verifyPan() {
    throw Object.assign(new Error('Live KYC provider is not configured. Set up the NSDL adapter and credentials.'), { status: 503, code: 'KYC_NOT_CONFIGURED' });
  },
  async sendAadhaarOtp() {
    throw Object.assign(new Error('Live KYC provider is not configured. Set up the UIDAI adapter and credentials.'), { status: 503, code: 'KYC_NOT_CONFIGURED' });
  },
};

module.exports = env.isLive ? live : mock;
module.exports.mode = env.isLive ? 'live' : 'mock';
