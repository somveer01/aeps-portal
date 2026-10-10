import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import { Card, Button, TextField, Select, Alert } from '../../components/UI';
import Receipt from '../../components/Receipt';
import ConfirmDialog from '../../components/ConfirmDialog';
import { api } from '../../api/client';
import { colors, radius, shadows } from '../../theme';
import { ServiceHeader } from './serviceKit';

const MODES = [{ label: 'IMPS', value: 'IMPS' }, { label: 'NEFT', value: 'NEFT' }];

export default function MoneyTransferScreen({ onBack, onDone }) {
  const [mobile, setMobile] = useState(''); const [sender, setSender] = useState(null);
  const [rows, setRows] = useState([]); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false); const [add, setAdd] = useState({ name: '', bankName: '', accountNo: '', ifsc: '' });
  const [xfer, setXfer] = useState(null); const [xf, setXf] = useState({ amount: '', mode: 'IMPS', txnPin: '' });
  const [receipt, setReceipt] = useState(null);

  const loadBens = async (id) => { const r = await api.dmt.beneficiaries(id); setRows(r.rows || []); };
  const search = async () => {
    setError(null); setBusy(true);
    try { const r = await api.dmt.sender(mobile); setSender(r.sender); await loadBens(r.sender.id); }
    catch (e) { setError(e.message); setSender(null); setRows([]); } finally { setBusy(false); }
  };
  const doAdd = async () => {
    setError(null);
    try { await api.dmt.addBeneficiary({ senderId: sender.id, ...add }); setAddOpen(false); setAdd({ name: '', bankName: '', accountNo: '', ifsc: '' }); await loadBens(sender.id); }
    catch (e) { setError(e.message); }
  };
  const verify = async (id) => { try { await api.dmt.verifyBeneficiary(id); await loadBens(sender.id); } catch (e) { setError(e.message); } };
  const [confirmSend, setConfirmSend] = useState(false); // "Send ₹X to ...?" dialog on top of the transfer form
  const askTransfer = () => {
    setError(null);
    if (!(Number(xf.amount) > 0)) { setError('Enter a valid amount.'); return; }
    if (!xf.txnPin) { setError('Enter your transaction PIN.'); return; }
    setConfirmSend(true);
  };
  const doTransfer = async () => {
    setConfirmSend(false); setError(null); setBusy(true);
    try {
      const r = await api.dmt.transfer({ beneficiaryId: xfer.id, amount: Number(xf.amount), mode: xf.mode, txnPin: xf.txnPin });
      setXfer(null); setXf({ amount: '', mode: 'IMPS', txnPin: '' }); setReceipt(r.receipt); await loadBens(sender.id); onDone && onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <ServiceHeader title="Money Transfer (DMT)" onBack={onBack} />
      {error ? <Alert type="error">{error}</Alert> : null}

      <Card>
        <Text style={styles.h}>Sender</Text>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 200 }}><Text style={styles.label}>Sender Mobile Number *</Text><TextField value={mobile} onChangeText={(v) => setMobile(v.replace(/\D/g, ''))} placeholder="Enter 10-digit mobile" keyboardType="numeric" maxLength={10} /></View>
          <Button title="Search" onPress={search} loading={busy} />
        </View>
        {sender ? (
          <View style={styles.senderCard}>
            <Text style={styles.senderName}>{sender.name} · {sender.mobile}</Text>
            <Text style={styles.senderMeta}>KYC: {sender.kycStatus} · Available Limit ₹{Number(sender.availableLimit).toFixed(2)} · Used ₹{Number(sender.usedLimit).toFixed(2)}</Text>
          </View>
        ) : null}
      </Card>

      {sender ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.h}>Beneficiaries</Text>
            <Button title="+ Add Beneficiary" onPress={() => setAddOpen(true)} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 640, flexGrow: 1 }}>
            <View style={{ flex: 1 }}>
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.cell, styles.cName, styles.thT]}>Name</Text>
                <Text style={[styles.cell, styles.cBank, styles.thT]}>Bank</Text>
                <Text style={[styles.cell, styles.cAcct, styles.thT]}>Account</Text>
                <Text style={[styles.cell, styles.cIfsc, styles.thT]}>IFSC</Text>
                <Text style={[styles.cell, styles.cAct, styles.thT]}>Action</Text>
              </View>
              {rows.length === 0 ? <Text style={{ color: colors.muted, padding: 16 }}>No beneficiaries yet.</Text> : rows.map((b, i) => (
                <View key={b.id} style={[styles.tr, i % 2 ? styles.trAlt : null]}>
                  <Text style={[styles.cell, styles.cName, styles.td]}>{b.name}</Text>
                  <Text style={[styles.cell, styles.cBank, styles.td]}>{b.bank_name}</Text>
                  <Text style={[styles.cell, styles.cAcct, styles.td]}>{b.account_no}</Text>
                  <Text style={[styles.cell, styles.cIfsc, styles.td]}>{b.ifsc}</Text>
                  <View style={[styles.cell, styles.cAct, { flexDirection: 'row', gap: 6 }]}>
                    {b.verified ? <Text style={styles.verified}>✓ Verified</Text> : <Pressable style={styles.smallBtnWarn} onPress={() => verify(b.id)}><Text style={styles.smallBtnText}>Verify</Text></Pressable>}
                    <Pressable style={[styles.smallBtn, !b.verified && { opacity: 0.5 }]} disabled={!b.verified} onPress={() => setXfer(b)}><Text style={styles.smallBtnTextLt}>Transfer</Text></Pressable>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      ) : null}

      {/* Add beneficiary modal */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
            <Text style={styles.h}>Add Beneficiary</Text>
            <View style={{ gap: 10, marginTop: 10 }}>
              <TextField label="Name" value={add.name} onChangeText={(v) => setAdd((p) => ({ ...p, name: v }))} placeholder="Beneficiary name" />
              <TextField label="Bank Name" value={add.bankName} onChangeText={(v) => setAdd((p) => ({ ...p, bankName: v }))} placeholder="Bank" />
              <TextField label="Account No" value={add.accountNo} onChangeText={(v) => setAdd((p) => ({ ...p, accountNo: v.replace(/\D/g, '') }))} placeholder="Account number" keyboardType="numeric" />
              <TextField label="IFSC" value={add.ifsc} onChangeText={(v) => setAdd((p) => ({ ...p, ifsc: v.toUpperCase() }))} placeholder="e.g. HDFC0001234" />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Button title="Cancel" variant="ghost" onPress={() => setAddOpen(false)} style={{ flex: 1 }} />
              <Button title="Add" onPress={doAdd} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDialog
        visible={confirmSend} danger={false} title="Confirm Money Transfer"
        message={xfer ? `Send ₹${Number(xf.amount || 0).toFixed(2)} to ${xfer.name} (${xfer.bank_name} · ${xfer.account_no}) via ${xf.mode}? The amount plus any service charge is debited from your wallet.` : ''}
        confirmText="Send Money" onConfirm={doTransfer} onCancel={() => setConfirmSend(false)}
      />

      {/* Transfer modal */}
      <Modal visible={!!xfer} transparent animationType="fade" onRequestClose={() => setXfer(null)}>
        <Pressable style={styles.backdrop} onPress={() => setXfer(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
            <Text style={styles.h}>Transfer to {xfer?.name}</Text>
            <Text style={styles.senderMeta}>{xfer?.bank_name} · {xfer?.account_no} · {xfer?.ifsc}</Text>
            <View style={{ gap: 10, marginTop: 12 }}>
              <TextField label="Amount" value={xf.amount} onChangeText={(v) => setXf((p) => ({ ...p, amount: v.replace(/[^\d.]/g, '') }))} placeholder="Enter amount" keyboardType="numeric" />
              <View><Text style={styles.label}>Mode</Text><Select value={xf.mode} options={MODES} onChange={(v) => setXf((p) => ({ ...p, mode: v }))} searchable={false} /></View>
              <TextField label="Transaction PIN / Password" value={xf.txnPin} onChangeText={(v) => setXf((p) => ({ ...p, txnPin: v }))} placeholder="Enter PIN" secureTextEntry />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Button title="Cancel" variant="ghost" onPress={() => setXfer(null)} style={{ flex: 1 }} />
              <Button title="Send" onPress={askTransfer} loading={busy} variant="navy" style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Receipt visible={!!receipt} status={receipt && receipt.status === 'pending' ? 'Processing' : 'Success'} onClose={() => setReceipt(null)} title="Money Transfer Receipt"
        rows={receipt ? [['Beneficiary', receipt.operator], ['Account', receipt.target], ['Mode', receipt.mode], ['Amount', `₹${Number(receipt.amount).toFixed(2)}`], ['UTR/Ref', receipt.provider?.utr || receipt.reference], ['Balance', `₹${Number(receipt.balance).toFixed(2)}`]] : []} />
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 15, fontWeight: '800', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  senderCard: { marginTop: 12, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: '#dbe6fb' },
  senderName: { fontWeight: '800', color: colors.text }, senderMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  trAlt: { backgroundColor: '#f8fafc' },
  th: { backgroundColor: colors.primary, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  thT: { color: '#fff', fontWeight: '700', fontSize: 11.5, textTransform: 'uppercase' },
  cell: { paddingVertical: 12, paddingHorizontal: 8 }, td: { color: colors.text, fontSize: 13 },
  cName: { width: 140 }, cBank: { width: 130 }, cAcct: { width: 120 }, cIfsc: { width: 120 }, cAct: { width: 170 },
  verified: { color: colors.success, fontWeight: '700', fontSize: 12, alignSelf: 'center' },
  smallBtn: { backgroundColor: colors.primary, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  smallBtnWarn: { backgroundColor: colors.warning, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 }, smallBtnTextLt: { color: '#fff', fontWeight: '700', fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 20, width: '100%', maxWidth: 440, ...shadows.pop },
});
