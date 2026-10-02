import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Card, Alert } from '../../components/UI';
import { api } from '../../api/client';
import DataGrid, { useGrid, useGridReload } from '../../components/DataGrid';
import { colors } from '../../theme';
import { reportStyles } from '../AccountHistoryScreen';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const td = reportStyles.td;

export default function MyCommissionSlabScreen() {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const grid = useGrid(); // DataGrid column sort + filters

  const load = useCallback(() => {
    setLoading(true); setError(null);
    return api.retailer.myCommissionSlab({ ...grid.params, pageSize: 100 })
      .then((r) => setRows(r.rows || [])).catch((e) => setError(e.message)).finally(() => setLoading(false));
    /* eslint-disable-next-line */
  }, [grid.sort, grid.filters]);
  useGridReload(grid, load);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <View style={{ gap: 16 }}>
      <Text style={reportStyles.heading}>My Commission Slab</Text>
      <Card>
        {error ? <Alert type="error">{error}</Alert> : null}
        <DataGrid
          rows={rows} loading={loading} emptyText="No commission slabs configured for your account type."
          sort={grid.sort} onSort={grid.setSort} filters={grid.filters} onFilter={grid.setFilters}
          columns={[
            { key: 'no', title: '#', width: 56, sortable: false, filterable: false, render: (r, i) => <Text style={td}>{i + 1}</Text> },
            { key: 'service', title: 'Service', width: 170, render: (r) => <View><Text style={td}>{r.service_name}</Text>{r.operator ? <Text style={reportStyles.sub}>{r.operator}</Text> : null}</View> },
            { key: 'commission_type', title: 'Commision Type', width: 140, render: (r) => <Text style={td}>{r.commission_type === 'amount' ? 'By Amount' : 'By Percentage'}</Text> },
            { key: 'range', title: 'Amount Range', width: 170, render: (r) => <Text style={td}>Rs {Number(r.min_amount).toFixed(2)} - {Number(r.max_amount).toFixed(2)}</Text> },
            { key: 'value', title: 'Amount / %', width: 130, render: (r) => <Text style={td}>{r.commission_type === 'amount' ? `Rs ${Number(r.value).toFixed(2)}` : `${Number(r.value).toFixed(2)} %`}</Text> },
            { key: 'plan', title: 'Plan', width: 140, render: (r) => <Text style={td}>{r.plan_name}</Text> },
            { key: 'txn_type', title: 'Type', width: 100, render: (r) => <Text style={{ fontSize: 13, fontWeight: '700', color: r.txn_type === 'debit' ? colors.danger : colors.success }}>{cap(r.txn_type)}</Text> },
          ]}
        />
      </Card>
    </View>
  );
}
