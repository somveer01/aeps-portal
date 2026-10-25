'use strict';

const bcrypt = require('bcryptjs');

/** A client value as text for a text column or a password: non-strings become '' and NUL bytes (which Postgres refuses) are dropped. */
// eslint-disable-next-line no-control-regex
const cleanStr = (v) => (typeof v === 'string' ? v.replace(/\u0000/g, '') : '');

/** bcrypt compare that answers false instead of throwing on a value it cannot hash (lone surrogate, non-string). */
async function safeCompare(plain, hash) {
  if (typeof plain !== 'string' || !hash) return false;
  try { return await bcrypt.compare(plain, hash); } catch (e) { return false; }
}

module.exports = { cleanStr, safeCompare };
