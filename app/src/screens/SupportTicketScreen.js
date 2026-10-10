import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, ScrollView, Pressable, Modal } from 'react-native';
import { Card, Button, Select, Alert, DateField, StatusBadge } from '../components/UI';
import { api } from '../api/client';
import DataGrid, { useGrid, useGridReload } from '../components/DataGrid';
import { colors, radius, shadows } from '../theme';
import { Fld, Pager, reportStyles } from './AccountHistoryScreen';
import { fmtDateTime as dt } from '../utils/dateTime';

const PAGE = 10;
const STATUS_OPTIONS = [{ label: 'All', value: '' }, { label: 'Open', value: 'open' }, { label: 'In Progress', value: 'in_progress' }, { label: 'Resolved', value: 'resolved' }, { label: 'Closed', value: 'closed' }];
const PRIORITY_OPTIONS = [{ label: 'All', value: '' }, { label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }];
const STATUS_SET = [{ label: 'Open', value: 'open' }, { label: 'In Progress', value: 'in_progress' }, { label: 'Resolved', value: 'resolved' }, { label: 'Closed', value: 'closed' }];
const statusTone = (s) => (s === 'open' ? 'warning' : s === 'in_progress' ? 'info' : s === 'resolved' ? 'success' : 'muted');
const cap = (s) => (s ? s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');

export default function SupportTicketScreen() {
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [depts, setDepts] = useState([]);
  const [ff, setFf] = useState({ startDate: '', endDate: '', status: '', priority: '', departmentId: '' });
  const [applied, setApplied] = useState({});
  const [active, setActive] = useState(null); // ticket being viewed in modal
  const set = (k, v) => setFf((p) => ({ ...p, [k]: v }));

  const grid = useGrid(); // DataGrid column sort + filters
  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.tickets.list({ ...applied, ...grid.params, page: p, pageSize: PAGE }); setRows(res.rows); setTotal(res.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, applied, grid.sort, grid.filters]);
  useGridReload(grid, () => load(1));

  useEffect(() => { load(1); api.ticketDepartments.list({ pageSize: 100 }).then((r) => setDepts([{ label: 'All', value: '' }, ...r.rows.map((d) => ({ label: d.name, value: d.id }))])).catch(() => {}); /* eslint-disable-next-line */ }, []);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [applied]);

  const openTicket = async (id) => { try { const r = await api.tickets.get(id); setActive(r.row); } catch (e) { setError(e.message); } };
  const refreshActive = async () => { const r = await api.tickets.get(active.id); setActive(r.row); load(page); };

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const from = total === 0 ? 0 : (page - 1) * PAGE + 1; const to = Math.min(total, page * PAGE);

  return (
    <View style={{ gap: 16 }}>
      <Text style={reportStyles.heading}>{total} Records — Support Tickets</Text>
      <Card>
        <View style={reportStyles.grid}>
          <Fld label="Start Date"><DateField value={ff.startDate} onChange={(v) => set('startDate', v)} /></Fld>
          <Fld label="End Date"><DateField value={ff.endDate} onChange={(v) => set('endDate', v)} /></Fld>
          <Fld label="Department"><Select value={ff.departmentId} options={depts} onChange={(v) => set('departmentId', v)} placeholder="All" /></Fld>
          <Fld label="Priority"><Select value={ff.priority} options={PRIORITY_OPTIONS} onChange={(v) => set('priority', v)} searchable={false} /></Fld>
          <Fld label="Status"><Select value={ff.status} options={STATUS_OPTIONS} onChange={(v) => set('status', v)} searchable={false} /></Fld>
          <View style={[reportStyles.field, { justifyContent: 'flex-end' }]}><Button title="Search" onPress={() => setApplied({ ...ff })} /></View>
        </View>
      </Card>

      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No tickets found." onRowPress={(r) => openTicket(r.id)}
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={reportStyles.td}>{from + i}</Text> },
            { key: 'ticket_no', title: 'Ticket No', width: 130, render: (r) => <Text style={[reportStyles.td, { fontWeight: '700' }]}>{r.ticket_no}</Text> },
            { key: 'user', title: 'Retailer', width: 160, render: (r) => <View><Text style={reportStyles.td}>{r.user_name}</Text><Text style={reportStyles.sub}>{r.user_code}</Text></View> },
            { key: 'subject', title: 'Subject', flex: 1, minWidth: 200, render: (r) => <Text style={reportStyles.td} numberOfLines={1}>{r.subject}</Text> },
            { key: 'department', title: 'Department', width: 140, render: (r) => <Text style={reportStyles.td}>{r.department_name}</Text> },
            { key: 'priority', title: 'Priority', width: 100, render: (r) => <Text style={[reportStyles.td, { textTransform: 'capitalize' }]}>{r.priority}</Text> },
            { key: 'status', title: 'Status', width: 120, render: (r) => <StatusBadge label={cap(r.status)} tone={statusTone(r.status)} /> },
            { key: 'created_at', title: 'Date', width: 175, render: (r) => <Text style={reportStyles.td}>{dt(r.created_at)}</Text> },
          ]}
        />
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>

      <Modal visible={!!active} transparent animationType="fade" onRequestClose={() => setActive(null)}>
        <Pressable style={styles.backdrop} onPress={() => setActive(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
            {active ? <TicketPanel ticket={active} depts={depts} onRefresh={refreshActive} onClose={() => setActive(null)} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function TicketPanel({ ticket, onRefresh, onClose }) {
  const [message, setMessage] = useState(''); const [status, setStatus] = useState(ticket.status);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(null);

  const send = async () => {
    if (!message.trim()) return;
    setError(null); setLoading(true);
    try { await api.tickets.reply(ticket.id, message.trim()); setMessage(''); await onRefresh(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  const saveStatus = async () => {
    setError(null); setLoading(true);
    try { await api.tickets.updateStatus(ticket.id, status); await onRefresh(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <ScrollView style={{ maxHeight: 560 }}>
      <View style={styles.head}>
        <Text style={styles.title}>{ticket.ticket_no} — {ticket.subject}</Text>
        <Pressable onPress={onClose}><Text style={{ fontSize: 20, color: colors.muted }}>✕</Text></Pressable>
      </View>
      <Text style={styles.metaLine}>By {ticket.user_name} ({ticket.user_code}) · {ticket.department_name} · <Text style={{ textTransform: 'capitalize' }}>{ticket.priority}</Text> priority</Text>
      <Text style={styles.desc}>{ticket.description}</Text>

      {error ? <Alert type="error">{error}</Alert> : null}

      <View style={{ gap: 8, marginVertical: 12 }}>
        {(ticket.replies || []).map((r) => (
          <View key={r.id} style={[styles.bubble, r.sender_role === 'admin' ? styles.bubbleMe : styles.bubbleUser]}>
            <Text style={styles.bubbleSender}>{r.sender_role === 'admin' ? 'You (Support)' : ticket.user_name} · {dt(r.created_at)}</Text>
            <Text style={styles.bubbleText}>{r.message}</Text>
          </View>
        ))}
      </View>

      <TextInput value={message} onChangeText={setMessage} placeholder="Type a reply…" placeholderTextColor={colors.muted} multiline numberOfLines={3} style={styles.textarea} />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <Button title="Send Reply" onPress={send} loading={loading} />
        <View style={{ flex: 1, minWidth: 160 }}><Select value={status} options={STATUS_SET} onChange={setStatus} searchable={false} /></View>
        <Button title="Update Status" variant="ghost" onPress={saveStatus} loading={loading} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 20, width: '100%', maxWidth: 560, ...shadows.pop },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, flex: 1 },
  metaLine: { color: colors.muted, fontSize: 12.5, marginTop: 4, marginBottom: 10 },
  desc: { color: colors.text, fontSize: 14, lineHeight: 20, backgroundColor: colors.surfaceAlt, padding: 12, borderRadius: radius.md },
  bubble: { padding: 12, borderRadius: radius.md, maxWidth: '90%' },
  bubbleMe: { backgroundColor: colors.primarySoft, alignSelf: 'flex-end' },
  bubbleUser: { backgroundColor: '#f1f5f9', alignSelf: 'flex-start' },
  bubbleSender: { fontSize: 11, fontWeight: '700', color: colors.muted, marginBottom: 4 },
  bubbleText: { fontSize: 13.5, color: colors.text, lineHeight: 19 },
  textarea: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.text, minHeight: 80, textAlignVertical: 'top' },
});
