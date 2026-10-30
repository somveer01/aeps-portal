import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from './UI';
import { toast } from './Toast';
import { colors } from '../theme';
import { todayISO } from '../utils/dateTime';
import { buildCsv, canDownload, fetchAllRows, openPrintWindow, printStatement, saveCsv, statementLines } from '../utils/statementExport';

const money = (v) => `₹${Number(v || 0).toFixed(2)}`;

// Under the Account History grid: total debit / credit (and opening / closing balance for one user) + Download CSV / PDF.
//   fetchPage(params) = the report's API call; params = the current filters (no paging); withUser = admin view (adds a User column).
export default function StatementBar({ totals, fetchPage, params, withUser = false, subtitle = '' }) {
  const [busy, setBusy] = useState('');
  const run = async (kind) => {
    if (!canDownload()) { toast.info('Download works in the web app.'); return; }
    const win = kind === 'pdf' ? openPrintWindow() : null; // opened inside the click, or the pop-up blocker stops it
    if (kind === 'pdf' && !win) { toast.warning('Allow pop-ups for this site to print the statement.'); return; }
    setBusy(kind);
    try {
      const all = await fetchAllRows(fetchPage, params);
      if (!all.rows.length) { if (win) win.close(); toast.info('No transactions to download.'); return; }
      const lines = statementLines(all.rows, { withUser });
      const stamp = todayISO();
      if (kind === 'csv') saveCsv(`account-statement-${stamp}.csv`, buildCsv(lines, { withUser }));
      else printStatement(win, { title: 'Account Statement', subtitle: subtitle || `${all.total} transactions`, lines, totals: all.totals || totals, withUser });
      if (all.truncated) toast.warning(`Only the latest ${all.rows.length} of ${all.total} transactions were downloaded. Narrow the dates for the rest.`);
    } catch (e) { if (win) win.close(); toast.error(e.message || 'Download failed.'); } finally { setBusy(''); }
  };

  return (
    <View style={s.wrap}>
      <View style={s.sums}>
        {totals ? (
          <>
            <Text style={s.t}>Total debit: <Text style={[s.v, { color: colors.danger }]}>{money(totals.debit)}</Text></Text>
            <Text style={s.t}>Total credit: <Text style={[s.v, { color: colors.success }]}>{money(totals.credit)}</Text></Text>
            {totals.opening !== undefined ? <Text style={s.t}>Opening balance: <Text style={s.v}>{money(totals.opening)}</Text></Text> : null}
            {totals.closing !== undefined ? <Text style={s.t}>Closing balance: <Text style={s.v}>{money(totals.closing)}</Text></Text> : null}
          </>
        ) : null}
      </View>
      <View style={s.btns}>
        <Button title="Download CSV" variant="navy" loading={busy === 'csv'} disabled={!!busy} onPress={() => run('csv')} />
        <Button title="Download PDF" variant="navy" loading={busy === 'pdf'} disabled={!!busy} onPress={() => run('pdf')} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 12, marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border },
  sums: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, flex: 1, minWidth: 240 },
  btns: { flexDirection: 'row', gap: 10 },
  t: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  v: { color: colors.text, fontWeight: '800' },
});
