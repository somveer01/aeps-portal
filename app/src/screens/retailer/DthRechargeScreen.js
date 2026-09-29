import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Card, Button, TextField, Select, Alert } from '../../components/UI';
import Receipt from '../../components/Receipt';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { ServiceHeader, formStyles } from './serviceKit';

export default function DthRechargeScreen({ onBack, onDone }) {
  const [ops, setOps] = useState([]);
  const [form, setForm] = useState({ number: '', operator: '', amount: '' });
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(null); const [receipt, setReceipt] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => { api.retailer.operators({ service: 'dth' }).then((r) => setOps(r.rows.map((o) => ({ label: o.name, value: o.name })))).catch(() => {}); }, []);

  const check = async () => { try { const r = await api.recharge.dthInfo({ operator: form.operator, number: form.number }); setInfo(r); } catch (e) { setError(e.message); } };
  const submit = async () => {
    setError(null); setLoading(true);
    try { const r = await api.recharge.dth({ number: form.number, operator: form.operator, amount: Number(form.amount) }); setReceipt(r.receipt); onDone && onDone(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <ServiceHeader title="DTH Recharge" onBack={onBack} />
      <View style={formStyles.row}>
        <Card style={formStyles.formCol}>
          {error ? <Alert type="error">{error}</Alert> : null}
          <Text style={formStyles.label}>DTH Number *</Text>
          <TextField value={form.number} onChangeText={(v) => set('number', v.replace(/\D/g, ''))} placeholder="Enter DTH number" keyboardType="numeric" />
          <Text style={[formStyles.label, { marginTop: 12 }]}>Operator *</Text>
          <Select value={form.operator} options={ops} onChange={(v) => set('operator', v)} placeholder="Select operator" />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <Text style={formStyles.label}>Recharge Amount *</Text>
            <Pressable onPress={check}><Text style={formStyles.link}>Check DTH Info</Text></Pressable>
          </View>
          <TextField value={form.amount} onChangeText={(v) => set('amount', v.replace(/[^\d.]/g, ''))} placeholder="Enter amount" keyboardType="numeric" />
          <View style={{ marginTop: 16 }}><Button title="Recharge" onPress={submit} loading={loading} variant="navy" /></View>
        </Card>

        <Card style={formStyles.infoCol}>
          <Text style={formStyles.infoTitle}>DTH Information</Text>
          {!info ? <Text style={{ color: colors.muted }}>Enter a DTH number + operator, then tap “Check DTH Info”.</Text> : (
            <View style={{ gap: 10 }}>
              {[['Current Balance', `₹${Number(info.currentBalance).toFixed(2)}`], ['Name', info.name], ['Next Recharge Date', info.nextRechargeDate], ['Status', info.status], ['Plan', info.planName]].map(([k, v]) => (
                <View key={k} style={styles.infoRow}><Text style={styles.infoK}>{k}</Text><Text style={styles.infoV}>{v}</Text></View>
              ))}
            </View>
          )}
        </Card>
      </View>

      <Receipt visible={!!receipt} status={receipt && receipt.status === 'pending' ? 'Processing' : 'Success'} onClose={() => setReceipt(null)} title="DTH Recharge Receipt"
        rows={receipt ? [['Operator', receipt.operator], ['DTH No', receipt.target], ['Amount', `₹${Number(receipt.amount).toFixed(2)}`], ['Reference', receipt.reference], ['Balance', `₹${Number(receipt.balance).toFixed(2)}`]] : []} />
    </View>
  );
}

const styles = StyleSheet.create({
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eef2f7', paddingBottom: 8 },
  infoK: { color: colors.muted, fontSize: 13, fontWeight: '600' }, infoV: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
