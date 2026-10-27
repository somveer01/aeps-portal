// Small commission helpers shared by the commission screens (Commission Overview ...). They repeat nothing the server decides: the server
// sends every slab and every amount; these only format numbers and preview what a typed value WOULD pay (the engine's computeAmounts:
// commission, then GST on top).
export const GST = 18;
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const money = (v) => `${Number(v) < 0 ? '-' : ''}₹${Math.abs(Number(v || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (v) => `${Number(v || 0).toFixed(2)}%`;
// "5%" or "₹5" for a slab { commissionType, value }
export const slabText = (c) => (c.commissionType === 'amount' ? `₹${Number(c.value)}` : `${Number(c.value)}%`);

// What one slab pays on `amount`: { commission, gst, net }.
export function calcSlab(type, value, amount) {
  const v = Number(value);
  const commission = round2(type === 'amount' ? v : (amount * v) / 100);
  const gst = Math.round(commission * GST) / 100;
  return { commission, gst, net: round2(commission + gst) };
}

// Is a typed slab value usable? (a number, 0 or more, and a percentage at most 100)
export function validSlabValue(type, text) {
  if (text === '' || text == null) return false;
  const v = Number(text);
  return Number.isFinite(v) && v >= 0 && !(type === 'percentage' && v > 100);
}
