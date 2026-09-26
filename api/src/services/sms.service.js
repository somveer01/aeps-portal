'use strict';

const env = require('../config/env');

/**
 * Pluggable SMS sender. The provider is chosen by SMS_PROVIDER:
 *   - "dev"   : prints the message to the terminal (no gateway needed)
 *   - "msg91" : sends via the MSG91 HTTP API (production)
 *
 * All providers expose the same async sendOtp(mobile, otp) signature so the
 * rest of the app never knows which one is active.
 */

async function devSend(mobile, otp) {
  // eslint-disable-next-line no-console
  console.log('\n──────────────── DEV SMS ────────────────');
  // eslint-disable-next-line no-console
  console.log(`  To    : ${mobile}`);
  // eslint-disable-next-line no-console
  console.log(`  OTP   : ${otp}`);
  // eslint-disable-next-line no-console
  console.log('  (enter this code on the OTP screen)');
  // eslint-disable-next-line no-console
  console.log('─────────────────────────────────────────\n');
  return { provider: 'dev', ok: true };
}

async function msg91Send(mobile, otp) {
  const { authKey, senderId, templateId } = env.sms.msg91;
  if (!authKey || !templateId) {
    throw new Error('MSG91 is not configured (MSG91_AUTH_KEY / MSG91_TEMPLATE_ID missing).');
  }

  // MSG91 flow API — sends a templated OTP. Mobile must include country code.
  const recipient = mobile.startsWith('91') || mobile.length > 10 ? mobile : `91${mobile}`;
  const res = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: authKey,
    },
    body: JSON.stringify({
      template_id: templateId,
      sender: senderId || undefined,
      recipients: [{ mobiles: recipient, otp }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MSG91 send failed (${res.status}): ${text}`);
  }
  return { provider: 'msg91', ok: true };
}

async function sendOtp(mobile, otp) {
  switch (env.sms.provider) {
    case 'msg91':
      return msg91Send(mobile, otp);
    case 'dev':
    default:
      return devSend(mobile, otp);
  }
}

module.exports = { sendOtp };
