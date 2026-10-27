import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';
import { money, pct, slabText } from '../../utils/commissionMath';

// The commission table: one block per service (its "All operators" row on top, the operators when opened), columns = API commission, one
// per level of the chain, optionally one "earns from downline" column, total paid, margin. Presentational: it shows what the server sent
// (GET /api/commission-overview) and reports clicks; the screen decides what a click does and what opens under a row.
//   levels    [{ key, title, sub }]  one column per chain member (title is shown as "<TITLE> GETS")
//   extra     { title, sub } | null  one more column fed by row.asUpline
//   services  the server's services (each with rows[]); open = Set of serviceIds that are open
//   active    { serviceId, operator, key } the cell being edited (highlighted)
//   onCell(svc, row, index | 'up'), onToggle(serviceId), renderEditor(svc, row) -> node shown under the row being edited
const COL = { name: 230, provider: 140, level: 150, paid: 120, margin: 160 };
const STATUS = { over: { text: 'More than the API pays', bg: '#fee2e2', fg: '#991b1b' }, gap: { text: 'A level earns nothing', bg: '#fef3c7', fg: '#92400e' } };

function Tag({ text, bg, fg }) { return <View style={[st.tag, { backgroundColor: bg }]}><Text style={[st.tagText, { color: fg }]} numberOfLines={1}>{text}</Text></View>; }

// One slab cell: "5% Chain", what it pays with GST, where it comes from (all operators / the user's own slab), a package if any.
function SlabCell({ cell, bottom, noPlan, upper, width, active, onPress }) {
  return (
    <Pressable onPress={onPress} disabled={noPlan} style={({ hovered }) => [st.cell, st.cellBtn, { width }, hovered && st.cellHover, active && st.cellActive]}>
      {cell.slotId ? (
        <>
          <Text style={[st.big, cell.inherited && { color: colors.muted }]}>{slabText(cell)} <Text style={st.chainTag}>{cell.chainType === 'chain' ? 'Chain' : 'Self'}</Text></Text>
          <Text style={st.sub}>{money(cell.net)}{cell.inherited ? ' · from all' : ''}{cell.others ? ` · +${cell.others} more` : ''}</Text>
        </>
      ) : <Text style={[st.sub, upper && { color: '#b45309' }]}>{noPlan ? 'no plan' : (upper ? 'earns nothing · set' : '— set')}</Text>}
      {cell.scope === 'user' ? <Tag text="His own slab" bg="#ede9fe" fg="#5b21b6" /> : null}
      {!cell.scope && cell.userSlabs ? <Text style={st.sub}>{cell.userSlabs} user slab{cell.userSlabs > 1 ? 's' : ''}</Text> : null}
      {cell.package ? <Text style={[st.sub, { color: '#0f766e' }]}>Package {cell.package.name}: {slabText(cell.package)}</Text> : null}
    </Pressable>
  );
}

export default function CommissionTable({ levels, extra, services, open, active, onToggle, onCell, renderEditor, emptyText = 'Nothing matches.' }) {
  const last = levels.length - 1;
  const width = COL.name + COL.provider + levels.length * COL.level + (extra ? COL.level : 0) + COL.paid + COL.margin;

  const renderRow = (svc, row, { header, isOpen, canOpen }) => {
    const status = STATUS[row.status];
    const editing = active && active.serviceId === svc.serviceId && active.operator === row.operator;
    return (
      <View key={`${svc.serviceId}:${row.operator}`}>
        <Pressable disabled={!header || !canOpen} onPress={() => onToggle(svc.serviceId)}
          style={({ hovered }) => [st.row, header ? null : st.rowSub, hovered && header && canOpen && st.rowHover, header && !svc.isActive && { opacity: 0.6 }]}>
          <View style={[st.cName, !header && { paddingLeft: 38 }]}>
            {header ? (canOpen ? <View style={[st.chev, isOpen && st.chevOpen]}><Text style={[st.chevText, isOpen && { color: colors.onPrimary }]}>{isOpen ? '▾' : '▸'}</Text></View> : <View style={st.chevSpace} />) : null}
            <View style={{ flexShrink: 1 }}>
              <Text style={header ? st.svcName : st.opName} numberOfLines={1}>{header ? svc.service : row.label}</Text>
              {header ? <Text style={st.sub} numberOfLines={1}>{svc.category || ''}{!svc.isActive ? ' · switched off' : ''}{canOpen ? ` · ${svc.rows.length - 1} operators` : ''}</Text> : null}
              {header ? <Text style={st.sub}>All operators</Text> : null}
            </View>
          </View>

          <View style={[st.cell, { width: COL.provider }]}>
            <Text style={[st.big, row.provider.amount < 0 && { color: colors.danger }]}>{money(row.provider.amount)}</Text>
            <Text style={st.sub}>{pct(row.provider.percent)} · {row.provider.source === 'sp_key' ? `SP key${row.provider.apiName ? ` (${row.provider.apiName})` : ''}` : (row.provider.source === 'service' ? 'Service Master' : 'no rate set')}</Text>
          </View>

          {row.cells.map((c, i) => (
            <SlabCell key={levels[i].key} cell={c} bottom={i === last} upper={i !== last} noPlan={!levels[i].hasPlan} width={COL.level}
              active={!!editing && active.key === levels[i].key && !active.up} onPress={() => onCell(svc, row, i)} />
          ))}
          {extra && row.asUpline ? <SlabCell cell={row.asUpline} upper width={COL.level} active={!!editing && !!active.up} noPlan={!levels[last].hasPlan} onPress={() => onCell(svc, row, 'up')} /> : null}

          <View style={[st.cell, { width: COL.paid }]}>
            <Text style={st.big}>{money(row.totalPaid)}</Text>
            <Text style={st.sub}>{pct(row.totalPaidPercent)} incl. GST</Text>
          </View>
          <View style={[st.cell, { width: COL.margin }]}>
            <Text style={[st.big, { color: row.margin < 0 ? colors.danger : colors.success }]}>{money(row.margin)} <Text style={st.sub}>· {pct(row.marginPercent)}</Text></Text>
            {status ? <Tag text={status.text} bg={status.bg} fg={status.fg} /> : (row.charge ? <Text style={st.sub}>incl. charge {money(row.charge)}</Text> : null)}
          </View>
        </Pressable>
        {editing && renderEditor ? renderEditor(svc, row) : null}
      </View>
    );
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={st.scroll}>
      <View style={{ width }}>
        <View style={st.head}>
          <Text style={[st.hText, { width: COL.name }]}>SERVICE / OPERATOR</Text>
          <Text style={[st.hText, { width: COL.provider }]}>API PAYS US</Text>
          {levels.map((c) => (
            <View key={c.key} style={{ width: COL.level, paddingHorizontal: 12 }}>
              <Text style={st.hTextInner} numberOfLines={1}>{String(c.title).toUpperCase()} GETS</Text>
              {c.sub ? <Text style={st.hSub} numberOfLines={1}>{c.sub}</Text> : null}
            </View>
          ))}
          {extra ? <View style={{ width: COL.level, paddingHorizontal: 12 }}><Text style={st.hTextInner} numberOfLines={1}>{String(extra.title).toUpperCase()}</Text>{extra.sub ? <Text style={st.hSub} numberOfLines={1}>{extra.sub}</Text> : null}</View> : null}
          <Text style={[st.hText, { width: COL.paid }]}>TOTAL PAID</Text>
          <Text style={[st.hText, { width: COL.margin }]}>COMPANY MARGIN</Text>
        </View>
        {services.length === 0 ? <View style={st.empty}><Text style={st.sub}>{emptyText}</Text></View> : null}
        {services.map((svc) => {
          const canOpen = svc.rows.length > 1; const isOpen = open.has(svc.serviceId);
          return (
            <View key={svc.serviceId} style={st.block}>
              {renderRow(svc, svc.rows[0], { header: true, isOpen, canOpen })}
              {isOpen ? svc.rows.slice(1).map((r) => renderRow(svc, r, { header: false })) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  scroll: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  head: { flexDirection: 'row', backgroundColor: '#f8fafc', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'flex-start' },
  hText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: colors.muted, paddingHorizontal: 12 },
  hTextInner: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: colors.muted },
  hSub: { fontSize: 11.5, color: colors.muted, marginTop: 1 },
  block: { borderBottomWidth: 1, borderBottomColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#fff' },
  rowSub: { backgroundColor: '#fafcff', borderTopWidth: 1, borderTopColor: '#eef2f7' },
  rowHover: { backgroundColor: '#f8fafc' },
  cName: { width: COL.name, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 12 },
  cell: { paddingVertical: 14, paddingHorizontal: 12, justifyContent: 'center', gap: 3 },
  cellBtn: { borderLeftWidth: 1, borderLeftColor: '#eef2f7' },
  cellHover: { backgroundColor: colors.primarySoft },
  cellActive: { backgroundColor: colors.primarySoft, borderBottomWidth: 3, borderBottomColor: colors.primary },
  svcName: { fontSize: 17, fontWeight: '800', color: colors.text },
  opName: { fontSize: 15, fontWeight: '700', color: colors.text },
  big: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12.5, color: colors.muted },
  chainTag: { fontSize: 11, fontWeight: '700', color: colors.primary },
  chev: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  chevOpen: { backgroundColor: colors.primary },
  chevText: { fontSize: 15, fontWeight: '800', color: colors.primary },
  chevSpace: { width: 28 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 12, fontWeight: '700' },
  empty: { padding: 28, alignItems: 'center' },
});
