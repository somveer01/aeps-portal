import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Card, Button, TextField, Select, Alert } from '../../components/UI';
import Receipt from '../../components/Receipt';
import { api } from '../../api/client';
import { colors, radius } from '../../theme';
import { ServiceHeader, formStyles } from './serviceKit';

const CIRCLES = ['Delhi NCR', 'Maharashtra', 'Karnataka', 'Uttar Pradesh (East)', 'Tamil Nadu', 'Gujarat', 'West Bengal'].map((c) => ({ label: c, value: c }));

export default function MobileRechargeScreen({ onBack, onDone }) {
  const [ops, setOps] = useState([]);
  const [form, setForm] = useState({ number: '', operator: '', circle: '', amount: '' });
  const [plans, setPlans] = useState(null); const [tab, setTab] = useState('TOPUP');
  const [loading, setLoading] = useState(false); const [error, setError] = useState(null); const [receipt, setReceipt] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => { api.retailer.operators({ service: 'mobile' }).then((r) => setOps(r.rows.map((o) => ({ label: o.name, value: o.name })))).catch(() => {}); }, []);

  const browse = async () => { try { const r = await api.recharge.plans({ operator: form.operator, circle: form.circle }); setPlans(r.tabs); setTab(r.tabs[0]?.key); } catch (e) { setError(e.message); } };
  const submit = async () => {
    setError(null); setLoading(true);
    try { const r = await api.recharge.mobile({ number: form.number, operator: form.operator, circle: form.circle, amount: Number(form.amount) }); setReceipt(r.receipt); onDone && onDone(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  const curTab = plans?.find((t) => t.key === tab);

  return (
    <View style={{ gap: 16 }}>
      <ServiceHeader title="Mobile Recharge" onBack={onBack} />
      <View style={formStyles.row}>
        <Card style={formStyles.formCol}>
          {error ? <Alert type="error">{error}</Alert> : null}
          <Text style={formStyles.label}>Mobile Number *</Text>
          <TextField value={form.number} onChangeText={(v) => set('number', v.replace(/\D/g, ''))} placeholder="Enter 10-digit number" keyboardType="numeric" maxLength={10} />
          <Text style={[formStyles.label, { marginTop: 12 }]}>Operator *</Text>
          <Select value={form.operator} options={ops} onChange={(v) => set('operator', v)} placeholder="Select operator" />
          <Text style={[formStyles.label, { marginTop: 12 }]}>Circle *</Text>
          <Select value={form.circle} options={CIRCLES} onChange={(v) => set('circle', v)} placeholder="Select circle" />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <Text style={formStyles.label}>Recharge Amount *</Text>
            <Pressable onPress={browse}><Text style={formStyles.link}>Browse Plans</Text></Pressable>
          </View>
          <TextField value={form.amount} onChangeText={(v) => set('amount', v.replace(/[^\d.]/g, ''))} placeholder="Enter amount" keyboardType="numeric" />
          <View style={{ marginTop: 16 }}><Button title="Recharge" onPress={submit} loading={loading} variant="navy" /></View>
        </Card>

        <Card style={formStyles.infoCol}>
          <Text style={formStyles.infoTitle}>Browse Plans</Text>
          {!plans ? <Text style={{ color: colors.muted }}>Pick an operator + circle and tap “Browse Plans”.</Text> : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {plans.map((t) => (
                  <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.planTab, tab === t.key && styles.planTabActive]}>
                    <Text style={[styles.planTabText, tab === t.key && { color: '#fff' }]}>{t.key}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {curTab?.plans.map((p, i) => (
                <Pressable key={i} style={styles.plan} onPress={() => set('amount', String(p.price))}>
                  <View style={{ flex: 1 }}><Text style={styles.planDesc}>{p.desc}</Text><Text style={styles.planMeta}>{p.circle} · {p.validity}</Text></View>
                  <View style={styles.planPrice}><Text style={styles.planPriceText}>₹{p.price}</Text></View>
                </Pressable>
              ))}
            </>
          )}
        </Card>
      </View>

      <Receipt visible={!!receipt} onClose={() => setReceipt(null)} title="Mobile Recharge Receipt"
        rows={receipt ? [['Operator', receipt.operator], ['Mobile', receipt.target], ['Amount', `₹${Number(receipt.amount).toFixed(2)}`], ['Reference', receipt.reference], ['Balance', `₹${Number(receipt.balance).toFixed(2)}`]] : []} />
    </View>
  );
}

const styles = StyleSheet.create({
  planTab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#f1f5f9', marginRight: 8 },
  planTabActive: { backgroundColor: colors.primary },
  planTabText: { fontWeight: '700', color: colors.text, fontSize: 12 },
  plan: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eef2f7', gap: 10 },
  planDesc: { color: colors.text, fontSize: 13 }, planMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  planPrice: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 10 },
  planPriceText: { color: colors.primary, fontWeight: '800' },
});
