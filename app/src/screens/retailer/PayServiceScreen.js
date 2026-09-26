import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Card, Button, TextField, Select, Alert } from '../../components/UI';
import Receipt from '../../components/Receipt';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { ServiceHeader, formStyles } from './serviceKit';

// kind: lic | gas | fastag | moveToBank
const CFG = {
  lic: { call: 'lic', opService: null, fields: [['policyNo', 'Policy Number *', 'default'], ['email', 'Customer Email *', 'default']] },
  gas: { call: 'gas', opService: 'gas', fields: [['consumerNo', 'Consumer Number *', 'default']] },
  fastag: { call: 'fastag', opService: 'fastag', fields: [['vehicle', 'Vehicle / Tag ID *', 'default']] },
  moveToBank: { call: 'moveToBank', opService: null, fields: [['accountNo', 'Account Number *', 'numeric'], ['ifsc', 'IFSC Code *', 'default']] },
};

export default function PayServiceScreen({ kind, title, onBack, onDone }) {
  const cfg = CFG[kind] || CFG.lic;
  const [ops, setOps] = useState([]); const [operator, setOperator] = useState('');
  const [vals, setVals] = useState({}); const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState(null); const [receipt, setReceipt] = useState(null);
  const set = (k, v) => setVals((p) => ({ ...p, [k]: v }));

  useEffect(() => { if (cfg.opService) api.retailer.operators({ service: cfg.opService }).then((r) => setOps(r.rows.map((o) => ({ label: o.name, value: o.name })))).catch(() => {}); }, [kind]);

  const submit = async () => {
    setError(null); setLoading(true);
    const target = vals.accountNo || vals.consumerNo || vals.vehicle || vals.policyNo || '';
    try {
      const r = await api.bbps[cfg.call]({ operator, target, amount: Number(amount), ...vals });
      setReceipt(r.receipt); onDone && onDone();
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <ServiceHeader title={title} onBack={onBack} />
      <View style={formStyles.row}>
        <Card style={formStyles.formCol}>
          {error ? <Alert type="error">{error}</Alert> : null}
          {cfg.opService ? (<><Text style={formStyles.label}>Operator *</Text><Select value={operator} options={ops} onChange={setOperator} placeholder="Select operator" /><View style={{ height: 12 }} /></>) : null}
          {cfg.fields.map(([key, label, kb]) => (
            <View key={key} style={{ marginBottom: 12 }}>
              <Text style={formStyles.label}>{label}</Text>
              <TextField value={vals[key] || ''} onChangeText={(v) => set(key, kb === 'numeric' ? v.replace(/\D/g, '') : v)} placeholder={label.replace(' *', '')} keyboardType={kb === 'numeric' ? 'numeric' : 'default'} />
            </View>
          ))}
          <Text style={formStyles.label}>Amount *</Text>
          <TextField value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} placeholder="Enter amount" keyboardType="numeric" />
          <View style={{ marginTop: 16 }}><Button title="Submit" onPress={submit} loading={loading} variant="navy" /></View>
        </Card>
        <Card style={formStyles.infoCol}>
          <Text style={formStyles.infoTitle}>Details</Text>
          <Text style={{ color: colors.muted }}>Fill the form and submit. On success your wallet is debited and a receipt is generated. Verify details with the operator before paying.</Text>
        </Card>
      </View>
      <Receipt visible={!!receipt} onClose={() => setReceipt(null)} title={`${title} Receipt`}
        rows={receipt ? [['Service', title], ...(receipt.operator ? [['Operator', receipt.operator]] : []), ['Reference', receipt.reference], ['Amount', `₹${Number(receipt.amount).toFixed(2)}`], ['Balance', `₹${Number(receipt.balance).toFixed(2)}`]] : []} />
    </View>
  );
}
