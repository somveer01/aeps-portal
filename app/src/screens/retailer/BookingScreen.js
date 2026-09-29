import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Card, Button, TextField, Alert } from '../../components/UI';
import Receipt from '../../components/Receipt';
import { api } from '../../api/client';
import { colors, radius } from '../../theme';
import { ServiceHeader, formStyles } from './serviceKit';

const TITLES = { flight: 'Flight Booking', hotel: 'Hotel Booking', bus: 'Bus Booking' };

export default function BookingScreen({ type, onBack, onDone }) {
  const [q, setQ] = useState({ from: '', to: '', date: '' });
  const [results, setResults] = useState(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); const [receipt, setReceipt] = useState(null); const [pax, setPax] = useState('');
  const set = (k, v) => setQ((p) => ({ ...p, [k]: v }));

  const search = async () => { setError(null); setBusy(true); try { const r = await api.booking.search(type, q); setResults(r.results || []); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const book = async (item) => {
    if (!pax.trim()) { setError('Enter passenger/guest name first'); return; }
    setError(null); setBusy(true);
    try { const r = await api.booking.book(type, { offerId: item.id, amount: item.price, pax: { name: pax } }); setReceipt(r.receipt); onDone && onDone(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <ServiceHeader title={TITLES[type]} onBack={onBack} />
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <View style={{ flex: 1, minWidth: 140 }}><Text style={formStyles.label}>{type === 'hotel' ? 'City' : 'From'}</Text><TextField value={q.from} onChangeText={(v) => set('from', v)} placeholder={type === 'hotel' ? 'City' : 'From'} /></View>
          {type !== 'hotel' ? <View style={{ flex: 1, minWidth: 140 }}><Text style={formStyles.label}>To</Text><TextField value={q.to} onChangeText={(v) => set('to', v)} placeholder="To" /></View> : null}
          <View style={{ flex: 1, minWidth: 140 }}><Text style={formStyles.label}>Passenger/Guest Name</Text><TextField value={pax} onChangeText={setPax} placeholder="Name" /></View>
          <Button title="Search" onPress={search} loading={busy} />
        </View>
      </Card>

      {results ? (
        <Card>
          <Text style={formStyles.infoTitle}>Results</Text>
          {results.length === 0 ? <Text style={{ color: colors.muted }}>No results.</Text> : results.map((r) => (
            <View key={r.id} style={styles.result}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rtitle}>{r.airline || r.name || r.operator}</Text>
                <Text style={styles.rmeta}>{[r.from && `${r.from} → ${r.to}`, r.depart && `Dep ${r.depart}`, r.arrive && `Arr ${r.arrive}`, r.city].filter(Boolean).join('  ·  ')}</Text>
              </View>
              <Text style={styles.price}>₹{r.price}</Text>
              <Pressable style={styles.book} onPress={() => book(r)}><Text style={styles.bookText}>Book</Text></Pressable>
            </View>
          ))}
        </Card>
      ) : null}

      <Receipt visible={!!receipt} status={receipt && receipt.status === 'pending' ? 'Processing' : 'Success'} onClose={() => setReceipt(null)} title={`${TITLES[type]} — E-Ticket`}
        rows={receipt ? [['Service', TITLES[type]], ['PNR', receipt.target], ['Amount', `₹${Number(receipt.amount).toFixed(2)}`], ['Reference', receipt.reference], ['Balance', `₹${Number(receipt.balance).toFixed(2)}`]] : []} />
    </View>
  );
}

const styles = StyleSheet.create({
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  rtitle: { fontWeight: '700', color: colors.text }, rmeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  price: { fontWeight: '800', color: colors.text }, book: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 14 },
  bookText: { color: '#fff', fontWeight: '700' },
});
