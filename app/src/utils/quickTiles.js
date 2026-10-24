// The dashboard's quick tiles: the services the user may use (catalogue, built from Service Master), the usual ones first.
const PRIORITY = ['mobile-recharge', 'aeps', 'money-transfer', 'bill-payment'];

/** tiles = catalogue b2b + online; returns [[title, icon, route], ...] (at most `max`). */
export function quickTiles(tiles, max = 6) {
  if (!tiles) return [];
  const rank = (t) => { const i = PRIORITY.indexOf(t.screen); return i < 0 ? 99 : i; };
  return tiles.filter((t) => t.key !== 'fund-request').map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).slice(0, max).map(({ t }) => [t.title, t.icon, t.route]);
}
