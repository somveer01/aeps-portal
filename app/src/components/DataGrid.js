import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

/**
 * Shared data grid: click a column title to sort (asc → desc → off), type in the box under it
 * to filter, the body scrolls under a fixed header and the whole grid scrolls sideways.
 * Sorting and filtering are done by the API over ALL records (see api/src/utils/gridQuery.js);
 * the parent keeps `sort` / `filters` in state and reloads page 1 when they change.
 *
 * columns: [{ key, title, width | flex(+minWidth), sortable = true, filterable = true,
 *             render?: (row, index) => node, align?: 'right' }]
 * Use sortable/filterable: false for '#' and action columns, or columns the API cannot sort.
 * rowStyle?: (row, index) => style — e.g. highlight a stuck transaction. onRowPress?: (row) => void opens a row.
 */
export default function DataGrid({
  columns, rows, loading, emptyText = 'No records found.', sort, onSort, filters = {}, onFilter,
  maxHeight = 560, rowKey = (r) => r.id, rowStyle, onRowPress,
}) {
  const minWidth = columns.reduce((a, c) => a + (c.width || c.minWidth || 120), 0);
  const anyFilter = Object.values(filters).some(Boolean);

  const toggleSort = (c) => {
    if (!onSort || c.sortable === false) return;
    if (!sort || sort.key !== c.key) onSort({ key: c.key, dir: 'asc' });
    else if (sort.dir === 'asc') onSort({ key: c.key, dir: 'desc' });
    else onSort(null);
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth, flexGrow: 1 }}>
      <View style={{ flex: 1 }}>
        <View style={[styles.tr, styles.th]}>
          {columns.map((c) => {
            const can = onSort && c.sortable !== false;
            const on = sort && sort.key === c.key;
            return (
              <Pressable key={c.key} onPress={() => toggleSort(c)} disabled={!can} style={[styles.cell, colStyle(c), styles.thCell, c.align === 'right' && styles.right]}>
                <Text style={styles.thText} numberOfLines={2}>{c.title}</Text>
                {can ? <Text style={[styles.arrow, on && styles.arrowOn]}>{on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</Text> : null}
              </Pressable>
            );
          })}
        </View>

        {onFilter ? (
          <View style={[styles.tr, styles.filterRow]}>
            {columns.map((c, i) => (
              <View key={c.key} style={[styles.filterCell, colStyle(c)]}>
                {c.filterable !== false ? (
                  <FilterInput value={filters[c.key] || ''} onChange={(v) => onFilter({ ...filters, [c.key]: v })} />
                ) : i === 0 && anyFilter ? (
                  <Pressable onPress={() => onFilter({})} hitSlop={6}><Text style={styles.clear} accessibilityLabel="Clear column filters">✕</Text></Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <ScrollView style={{ maxHeight }} nestedScrollEnabled>
          {loading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
            : !rows.length ? <View style={styles.empty}><Text style={{ color: colors.muted }}>{anyFilter ? 'No records match the column filters.' : emptyText}</Text></View>
              : rows.map((r, i) => (
                <Row key={rowKey(r, i)} onPress={onRowPress ? () => onRowPress(r) : null} style={[styles.tr, i % 2 ? styles.trAlt : null, rowStyle ? rowStyle(r, i) : null]}>
                  {columns.map((c) => (
                    <View key={c.key} style={[styles.cell, colStyle(c), c.align === 'right' && styles.right]}>
                      {c.render ? c.render(r, i) : <Text style={styles.td} numberOfLines={3}>{r[c.key] == null || r[c.key] === '' ? '—' : String(r[c.key])}</Text>}
                    </View>
                  ))}
                </Row>
              ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

// A clickable row when onRowPress is given, a plain one otherwise.
const Row = ({ onPress, style, children }) => (onPress ? <Pressable onPress={onPress} style={style}>{children}</Pressable> : <View style={style}>{children}</View>);

// Typing is debounced so the API is asked once the user pauses.
function FilterInput({ value, onChange }) {
  const [text, setText] = useState(value);
  const timer = useRef(null);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v.trim()), 450);
  };
  return <TextInput value={text} onChangeText={change} placeholder="Filter…" placeholderTextColor="#94a3b8" style={styles.filterInput} />;
}

const colStyle = (c) => (c.width ? { width: c.width } : { flex: c.flex || 1, minWidth: c.minWidth || 120 });

/**
 * Grid state for a screen: const grid = useGrid(); pass grid.params to the list API, and
 * <DataGrid sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters} />.
 * Then useGridReload(grid, () => load({ page: 1 })) reloads page 1 when sort / filters change.
 */
export function useGrid() {
  const [sort, setSort] = useState(null);
  const [filters, setFilters] = useState({});
  return { sort, setSort, filters, setFilters, params: gridParams(sort, filters) };
}

export function useGridReload(grid, reload) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // the screen's own mount effect loads first
    reloadRef.current();
  }, [grid.sort, grid.filters]);
}

/** Query params for the API from the grid state: { sort, dir, f_<key> }. */
export function gridParams(sort, filters = {}) {
  const out = sort ? { sort: sort.key, dir: sort.dir } : {};
  Object.entries(filters).forEach(([k, v]) => { if (v) out[`f_${k}`] = v; });
  return out;
}

const styles = StyleSheet.create({
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  trAlt: { backgroundColor: '#f8fafc' },
  th: { backgroundColor: colors.primary, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, borderBottomWidth: 0 },
  thCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thText: { color: '#fff', fontWeight: '700', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 1 },
  arrow: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },
  arrowOn: { color: '#fff' },
  right: { justifyContent: 'flex-end' },
  filterRow: { backgroundColor: '#f1f5f9', borderBottomColor: colors.border },
  filterCell: { paddingVertical: 6, paddingHorizontal: 6 },
  filterInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12.5, color: colors.text, outlineStyle: 'none' },
  clear: { color: colors.danger, fontSize: 12, fontWeight: '700', paddingHorizontal: 4 },
  cell: { paddingVertical: 12, paddingHorizontal: 9 },
  td: { color: colors.text, fontSize: 13 },
  empty: { padding: 34, alignItems: 'center' },
});
