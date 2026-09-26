'use strict';

/**
 * Lightweight, dependency-free validation helpers shared across controllers so
 * field rules (regex, ranges, enums) live in one place instead of being
 * re-implemented per controller. Each helper throws a ValidationError (400) on
 * failure; the central error handler turns it into a JSON response.
 */
class ValidationError extends Error {
  constructor(message, code = 'INVALID') {
    super(message);
    this.status = 400;
    this.code = code;
  }
}

const clean = (v) => String(v == null ? '' : v).trim();

function str(v, label, { min = 1, max = 500 } = {}) {
  const s = clean(v);
  if (s.length < min) throw new ValidationError(`${label} is required`, 'REQUIRED');
  if (s.length > max) throw new ValidationError(`${label} is too long`, 'TOO_LONG');
  return s;
}

function optionalStr(v, { max = 500 } = {}) {
  const s = clean(v);
  return s.slice(0, max);
}

function money(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`Enter a valid ${label}`, 'INVALID_AMOUNT');
  return Math.round(n * 100) / 100;
}

function id(v, label) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`Please select a valid ${label}`, 'INVALID_REF');
  return n;
}

function oneOf(v, allowed, label) {
  const s = clean(v);
  if (!allowed.includes(s)) throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`, 'INVALID_ENUM');
  return s;
}

function match(v, re, label, code = 'INVALID_FORMAT') {
  const s = clean(v);
  if (!re.test(s)) throw new ValidationError(`Enter a valid ${label}`, code);
  return s;
}

module.exports = { ValidationError, clean, str, optionalStr, money, id, oneOf, match };
