'use strict';

// Money helpers shared by every module that moves money (wallets are numeric(14,2): rupees with 2 decimals).

/** Round to 2 decimals (paise). */
const round2 = (n) => Math.round(n * 100) / 100;

/** True when `n` has at most 2 decimals - so ₹1.005 is refused instead of being silently rounded. */
const hasMax2Decimals = (n) => Number.isFinite(n) && Math.abs(Math.round(n * 100) - n * 100) <= 1e-6;

/** A positive amount with at most 2 decimals: what every money endpoint accepts. */
const isMoneyAmount = (n) => Number.isFinite(n) && n > 0 && hasMax2Decimals(n);

module.exports = { round2, hasMax2Decimals, isMoneyAmount };
