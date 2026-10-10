'use strict';

const crypto = require('crypto');

const MIN_PASSWORD = 8; // same as Change Password

// 10 characters, no look-alikes (0/O, 1/l/I), always at least one letter of each case and one digit.
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; const lower = 'abcdefghijkmnopqrstuvwxyz'; const digits = '23456789';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < 10) chars.push(pick(upper + lower + digits));
  for (let i = chars.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

module.exports = { MIN_PASSWORD, generatePassword };
