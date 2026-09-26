import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Alert } from '../../components/UI';
import { api } from '../../api/client';
import { colors } from '../../theme';
import { reportStyles } from '../AccountHistoryScreen';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

export default function MyCommissionSlabScreen() {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  useEffect(() => { api.retailer.myCommissionSlab({ pageSize: 100 }).then((r) => setRows(r.rows || [])).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);

  return (
    <View style={{ gap: 16 }}>
      <Text style={reportStyles.heading}>My Commission Slab</Text>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 900, flexGrow: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[reportStyles.tr, reportStyles.th]}>
              {['#', 'Service', 'Commision Type', 'Amount Range', 'Amount / %', 'Plan', 'Type'].map((h, i) => (
                <Text key={i} style={[reportStyles.cell, reportStyles.thText, { width: [40, 160, 130, 170, 120, 130, 80][i] }]}>{h}</Text>
              ))}
            </View>
            {loading ? <View style={reportStyles.empty}><ActivityIndicator color={colors.primary} /></View>
              : rows.length === 0 ? <View style={reportStyles.empty}><Text style={{ color: colors.muted }}>No commission slabs configured for your account type.</Text></View>
                : rows.map((r, i) => (
                  <View key={r.id} style={[reportStyles.tr, i % 2 ? reportStyles.trAlt : null]}>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 40 }]}>{i + 1}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 160 }]}>{r.service_name}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 130 }]}>{r.commission_type === 'amount' ? 'By Amount' : 'By Percentage'}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 170 }]}>Rs {Number(r.min_amount).toFixed(2)} - {Number(r.max_amount).toFixed(2)}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 120 }]}>{r.commission_type === 'amount' ? `Rs ${Number(r.value).toFixed(2)}` : `${Number(r.value).toFixed(2)} %`}</Text>
                    <Text style={[reportStyles.cell, reportStyles.td, { width: 130 }]}>{r.plan_name}</Text>
                    <Text style={[reportStyles.cell, { width: 80, fontSize: 13, fontWeight: '700', color: r.txn_type === 'debit' ? colors.danger : colors.success }]}>{cap(r.txn_type)}</Text>
                  </View>
                ))}
          </View>
        </ScrollView>
      </Card>
    </View>
  );
}
