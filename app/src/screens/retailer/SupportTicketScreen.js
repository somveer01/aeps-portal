import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { Card, Button, TextField, Select, Alert, StatusBadge } from '../../components/UI';
import { api } from '../../api/client';
import { colors, radius } from '../../theme';
import { Pager, reportStyles } from '../AccountHistoryScreen';

const PAGE = 10;
const STATUS_OPTIONS = [{ label: 'All', value: '' }, { label: 'Open', value: 'open' }, { label: 'In Progress', value: 'in_progress' }, { label: 'Resolved', value: 'resolved' }, { label: 'Closed', value: 'closed' }];
const PRIORITY_OPTIONS = [{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }];
const statusTone = (s) => (s === 'open' ? 'warning' : s === 'in_progress' ? 'info' : s === 'resolved' ? 'success' : 'muted');
const cap = (s) => (s ? s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const dt = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function SupportTicketScreen() {
  const [view, setView] = useState('list'); // list | new | detail
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [depts, setDepts] = useState([]);
  const [ticket, setTicket] = useState(null);

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null);
    try { const res = await api.retailerTickets.list({ status, page: p, pageSize: PAGE }); setRows(res.rows); setTotal(res.total); setPage(p); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [page, status]);

  useEffect(() => { if (view === 'list') load(1); /* eslint-disable-next-line */ }, [status, view]);
  useEffect(() => { api.ticketDepartments.list({ pageSize: 100 }).then((r) => setDepts(r.rows.map((d) => ({ label: d.name, value: d.id })))).catch(() => {}); }, []);

  const openTicket = async (id) => {
    setError(null);
    try { const r = await api.retailerTickets.get(id); setTicket(r.row); setView('detail'); } catch (e) { setError(e.message); }
  };

  if (view === 'new') return <NewTicketForm depts={depts} onBack={() => setView('list')} onCreated={(row) => { setTicket(row); setView('detail'); }} />;
  if (view === 'detail') return <TicketDetail ticket={ticket} onBack={() => { setView('list'); load(1); }} onRefresh={async () => { const r = await api.retailerTickets.get(ticket.id); setTicket(r.row); }} />;

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const from = total === 0 ? 0 : (page - 1) * PAGE + 1; const to = Math.min(total, page * PAGE);

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={reportStyles.heading}>{total} Records — My Support Tickets</Text>
        <Button title="+ New Ticket" onPress={() => setView('new')} />
      </View>
      <Card>
        <View style={{ maxWidth: 240 }}><Select value={status} options={STATUS_OPTIONS} onChange={setStatus} searchable={false} /></View>
      </Card>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 815, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[reportStyles.tr, reportStyles.th]}>
              {['#', 'Ticket No', 'Subject', 'Department', 'Priority', 'Status', 'Date'].map((h, i) => (
                <Text key={i} numberOfLines={1} style={[reportStyles.cell, reportStyles.thText, { width: [40, 130, 200, 130, 80, 115, 130][i] }]}>{h}</Text>
              ))}
            </View>
            {loading ? <View style={reportStyles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={reportStyles.empty}><Text style={{ color: colors.muted }}>No tickets yet — raise one if you need help.</Text></View>
                : rows.map((r, i) => (
                  <Pressable key={r.id} onPress={() => openTicket(r.id)} style={[reportStyles.tr, i % 2 ? reportStyles.trAlt : null]}>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 40 }]}>{from + i}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 130, fontWeight: '700' }]}>{r.ticket_no}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 200 }]} numberOfLines={1}>{r.subject}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 130 }]}>{r.department_name}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 80, textTransform: 'capitalize' }]}>{r.priority}</Text>
                    <View style={[reportStyles.cell, { width: 115 }]}><StatusBadge label={cap(r.status)} tone={statusTone(r.status)} /></View>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 130 }]}>{dt(r.created_at)}</Text>
                  </Pressable>
                ))}
          </View>
        </ScrollView>
        <Pager page={page} totalPages={totalPages} from={from} to={to} total={total} onGo={load} />
      </Card>
    </View>
  );
}

function NewTicketForm({ depts, onBack, onCreated }) {
  const [departmentId, setDepartmentId] = useState('');
  const [subject, setSubject] = useState(''); const [priority, setPriority] = useState('medium'); const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState(null);

  const submit = async () => {
    setError(null); setLoading(true);
    try { const r = await api.retailerTickets.create({ departmentId, subject, priority, description }); onCreated(r.row); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={reportStyles.heading}>Raise a New Ticket</Text>
        <Button title="‹ Back" variant="ghost" onPress={onBack} />
      </View>
      <Card style={{ maxWidth: 560 }}>
        {error ? <Alert type="error">{error}</Alert> : null}
        <Text style={styles.label}>Department *</Text>
        <Select value={departmentId} options={depts} onChange={setDepartmentId} placeholder="Select department" />
        <Text style={[styles.label, { marginTop: 12 }]}>Subject *</Text>
        <TextField value={subject} onChangeText={setSubject} placeholder="Brief summary of the issue" />
        <Text style={[styles.label, { marginTop: 12 }]}>Priority *</Text>
        <Select value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} searchable={false} />
        <Text style={[styles.label, { marginTop: 12 }]}>Description *</Text>
        <TextInput value={description} onChangeText={setDescription} placeholder="Describe the issue in detail" placeholderTextColor={colors.muted} multiline numberOfLines={5} style={styles.textarea} />
        <View style={{ marginTop: 16 }}><Button title="Submit Ticket" onPress={submit} loading={loading} variant="navy" /></View>
      </Card>
    </View>
  );
}

function TicketDetail({ ticket, onBack, onRefresh }) {
  const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState(null);
  if (!ticket) return null;
  const closed = ticket.status === 'closed';

  const send = async () => {
    if (!message.trim()) return;
    setError(null); setLoading(true);
    try { await api.retailerTickets.reply(ticket.id, message.trim()); setMessage(''); await onRefresh(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.headRow}>
        <Text style={reportStyles.heading}>{ticket.ticket_no} — {ticket.subject}</Text>
        <Button title="‹ Back" variant="ghost" onPress={onBack} />
      </View>
      <Card>
        <View style={styles.metaRow}>
          <Text style={styles.metaItem}>Department: <Text style={styles.metaVal}>{ticket.department_name}</Text></Text>
          <Text style={styles.metaItem}>Priority: <Text style={styles.metaVal}>{cap(ticket.priority)}</Text></Text>
          <StatusBadge label={cap(ticket.status)} tone={statusTone(ticket.status)} />
        </View>
        <Text style={styles.desc}>{ticket.description}</Text>
      </Card>
      <Card>
        <Text style={styles.label}>Conversation</Text>
        <View style={{ gap: 10, marginTop: 10 }}>
          {(ticket.replies || []).length === 0 ? <Text style={{ color: colors.muted }}>No replies yet.</Text> : ticket.replies.map((r) => (
            <View key={r.id} style={[styles.bubble, r.sender_role === 'admin' ? styles.bubbleAdmin : styles.bubbleMe]}>
              <Text style={styles.bubbleSender}>{r.sender_role === 'admin' ? 'Support Team' : 'You'} · {dt(r.created_at)}</Text>
              <Text style={styles.bubbleText}>{r.message}</Text>
            </View>
          ))}
        </View>
        {error ? <Alert type="error">{error}</Alert> : null}
        {!closed ? (
          <View style={{ marginTop: 14, gap: 10 }}>
            <TextInput value={message} onChangeText={setMessage} placeholder="Type a reply…" placeholderTextColor={colors.muted} multiline numberOfLines={3} style={styles.textarea} />
            <Button title="Send Reply" onPress={send} loading={loading} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : <Text style={{ color: colors.muted, marginTop: 12 }}>This ticket is closed.</Text>}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569' },
  textarea: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.text, minHeight: 90, textAlignVertical: 'top' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginBottom: 10 },
  metaItem: { color: colors.muted, fontSize: 13 }, metaVal: { color: colors.text, fontWeight: '600' },
  desc: { color: colors.text, fontSize: 14, lineHeight: 21 },
  bubble: { padding: 12, borderRadius: radius.md, maxWidth: '85%' },
  bubbleMe: { backgroundColor: colors.primarySoft, alignSelf: 'flex-end' },
  bubbleAdmin: { backgroundColor: '#f1f5f9', alignSelf: 'flex-start' },
  bubbleSender: { fontSize: 11, fontWeight: '700', color: colors.muted, marginBottom: 4 },
  bubbleText: { fontSize: 13.5, color: colors.text, lineHeight: 19 },
});
