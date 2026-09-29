import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Button, Select, Alert } from '../../components/UI';
import Receipt from '../../components/Receipt';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { ServiceHeader, formStyles } from './serviceKit';

const CATEGORIES = ['Electricity', 'Insurance', 'Water', 'Gas'].map((c) => ({ label: c, value: c }));
const MODES = [{ label: 'Online', value: 'Online' }, { label: 'Cash', value: 'Cash' }];

export default function BillPaymentScreen({ onBack, onDone }) {
  const [category, setCategory] = useState('Electricity');
  const [ops, setOps] = useState([]); const [operator, setOperator] = useState(''); const [mode, setMode] = useState('Online');
  const [bill, setBill] = useState(null); const [loading, setLoading] = useState(false); const [paying, setPaying] = useState(false);
  const [error, setError] = useState(null); const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    setOperator(''); setBill(null);
    api.retailer.operators({ service: 'bbps', category }).then((r) => setOps(r.rows.map((o) => ({ label: o.name, value: o.name })))).catch(() => {});
  }, [category]);

  const check = async () => {
    setError(null); setBill(null); setLoading(true);
    try { const r = await api.bbps.fetchBill({ category, operator }); setBill(r.bill); } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  const pay = async () => {
    setError(null); setPaying(true);
    try { const r = await api.bbps.pay({ category, operator, amount: Number(bill.amount), target: bill.billNumber }); setReceipt(r.receipt); onDone && onDone(); }
    catch (e) { setError(e.message); } finally { setPaying(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <ServiceHeader title="Bill Payment" onBack={onBack} />
      <View style={formStyles.row}>
        <Card style={formStyles.formCol}>
          {error ? <Alert type="error">{error}</Alert> : null}
          <Text style={formStyles.label}>Category *</Text>
          <Select value={category} options={CATEGORIES} onChange={setCategory} searchable={false} />
          <Text style={[formStyles.label, { marginTop: 12 }]}>Operator Name *</Text>
          <Select value={operator} options={ops} onChange={setOperator} placeholder="Select operator" />
          <Text style={[formStyles.label, { marginTop: 12 }]}>Mode *</Text>
          <Select value={mode} options={MODES} onChange={setMode} searchable={false} />
          <View style={{ marginTop: 16 }}><Button title="Check Bill" onPress={check} loading={loading} /></View>
        </Card>

        <Card style={formStyles.infoCol}>
          <Text style={formStyles.infoTitle}>Bill Details</Text>
          {!bill ? <Text style={{ color: colors.muted }}>Choose category + operator and tap “Check Bill”. Verify with your operator before paying.</Text> : (
            <View style={{ gap: 10 }}>
              {[['Name', bill.name], ['Bill Number', bill.billNumber], ['Amount', `₹${Number(bill.amount).toFixed(2)}`], ['Due Date', bill.dueDate], ['Bill Date', bill.billDate]].map(([k, v]) => (
                <View key={k} style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>
              ))}
              <View style={{ marginTop: 8 }}><Button title={`Pay ₹${Number(bill.amount).toFixed(2)}`} onPress={pay} loading={paying} variant="navy" /></View>
            </View>
          )}
        </Card>
      </View>

      <Receipt visible={!!receipt} status={receipt && receipt.status === 'pending' ? 'Processing' : 'Success'} onClose={() => setReceipt(null)} title="Bill Payment Receipt"
        rows={receipt ? [['Operator', receipt.operator], ['Bill No', receipt.target], ['Amount', `₹${Number(receipt.amount).toFixed(2)}`], ['Reference', receipt.reference], ['Balance', `₹${Number(receipt.balance).toFixed(2)}`]] : []} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eef2f7', paddingBottom: 8 },
  k: { color: colors.muted, fontSize: 13, fontWeight: '600' }, v: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
