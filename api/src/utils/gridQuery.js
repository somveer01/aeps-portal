'use strict';

/**
 * Column sort + per-column filter for list endpoints (the app's DataGrid).
 *   ?sort=<key>&dir=asc|desc   sort the whole result (not just one page)
 *   ?f_<key>=<text>            keep rows whose column contains <text> (case-insensitive)
 * Only keys in the endpoint's column map are honoured, and the SQL comes from that map,
 * never from the request, so a client cannot inject an expression. Values are bound.
 *
 * Column map entry: key -> 'sql expression' or { sort: 'expr', filter: 'expr' } (e.g. a
 * date filtered on its displayed text while sorted on the timestamp itself).
 */
const DATE_TEXT = (col) => `to_char(${col}, 'DD Mon YYYY HH24:MI YYYY-MM-DD')`;
// A date column sorted on the value and filtered on its displayed text; a status switch filtered as words.
const DATE_COL = (col) => ({ sort: col, filter: DATE_TEXT(col) });
const STATUS_COL = (col) => ({ sort: col, filter: `case when ${col} then 'active on yes' else 'inactive off no blocked' end` });

function parseGrid(query = {}, columns = {}) {
  const expr = (key, kind) => {
    const c = columns[key];
    if (!c) return null;
    return typeof c === 'string' ? c : c[kind] || c.sort;
  };
  const sortKey = String(query.sort || '');
  const sortCol = expr(sortKey, 'sort');
  const sort = sortCol ? { col: sortCol, dir: String(query.dir).toLowerCase() === 'asc' ? 'asc' : 'desc' } : null;
  const filters = Object.keys(query)
    .filter((k) => k.startsWith('f_'))
    .map((k) => ({ col: expr(k.slice(2), 'filter'), value: String(query[k] || '').trim().slice(0, 100) }))
    .filter((f) => f.col && f.value);
  return { sort, filters };
}

function applyGridFilters(qb, grid) {
  if (!grid) return;
  grid.filters.forEach(({ col, value }) => qb.whereRaw(`cast(${col} as text) ilike ?`, [`%${value.replace(/[%_\\]/g, '\\$&')}%`]));
}

/** Sort by the chosen column (nulls last), then by the fallback so paging stays stable. */
function applyGridSort(qb, grid, fallbackCol, fallbackDir = 'desc') {
  if (grid && grid.sort) qb.orderByRaw(`${grid.sort.col} ${grid.sort.dir} nulls last`);
  qb.orderBy(fallbackCol, fallbackDir);
}

/** Only the chosen column sort; call before the list's own orderBy, which then breaks ties. */
function applyGridSortFirst(qb, grid) {
  if (grid && grid.sort) qb.orderByRaw(`${grid.sort.col} ${grid.sort.dir} nulls last`);
}

module.exports = { parseGrid, applyGridFilters, applyGridSort, applyGridSortFirst, DATE_TEXT, DATE_COL, STATUS_COL };
