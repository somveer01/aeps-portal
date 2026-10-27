import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Alert, Button } from '../UI';
import { colors, radius } from '../../theme';

// The small editor that opens under a commission row: % or ₹, the value, self / chain, an optional "who does this apply to" choice, a
// preview line (the margin after the change) and Save / Cancel / Remove. Presentational only: the screen owns the state and does the save.
//   title, notes[]        heading and amber notes
//   type, value, chain    the current inputs; onChange(patch) with { type?, value?, chain? }
//   showChain             false = the slab is a chain slab and cannot be changed (a level above the sale)
//   scopes, scope, onScope  [{ key, label }] radio-like choice (e.g. only this user / everyone of the type); omit for none
//   preview { text, negative }  one line shown under the inputs
//   error, saving, onSave, onCancel, onRemove, removeLabel
export default function SlabEditor({ title, notes = [], type, value, chain, onChange, showChain = true, chainText, scopes, scope, onScope, preview, error, saving, onSave, onCancel, onRemove, removeLabel = 'Remove slab' }) {
  return (
    <View style={st.box}>
      <Text style={st.title}>{title}</Text>
      {notes.map((n, i) => <Text key={i} style={st.note}>{n}</Text>)}
      {scopes && scopes.length ? (
        <View style={st.row}>
          {scopes.map((s) => (
            <Pressable key={s.key} onPress={() => onScope && onScope(s.key)} style={[st.scope, scope === s.key && st.scopeOn]}>
              <Text style={[st.scopeText, scope === s.key && { color: colors.onPrimary }]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={st.row}>
        <View style={st.seg}>
          {[['percentage', '%'], ['amount', '₹']].map(([k, l]) => (
            <Pressable key={k} onPress={() => onChange({ type: k })} style={[st.segBtn, type === k && st.segOn]}><Text style={[st.segText, type === k && { color: colors.onPrimary }]}>{l}</Text></Pressable>
          ))}
        </View>
        <TextInput value={value} onChangeText={(v) => onChange({ value: v })} keyboardType="numeric" placeholder={type === 'amount' ? 'Rupees per transaction' : 'Percent of the amount'} placeholderTextColor={colors.muted} style={st.input} autoFocus />
        {showChain ? (
          <View style={st.seg}>
            {[['self', 'Self'], ['chain', 'Chain']].map(([k, l]) => (
              <Pressable key={k} onPress={() => onChange({ chain: k })} style={[st.segBtn, chain === k && st.segOn]}><Text style={[st.segText, chain === k && { color: colors.onPrimary }]}>{l}</Text></Pressable>
            ))}
          </View>
        ) : <Text style={st.sub}>{chainText || 'Chain slab'}</Text>}
      </View>
      {preview ? <Text style={[st.preview, preview.negative && { color: colors.danger }]}>{preview.text}</Text> : null}
      {error ? <Alert type="error">{error}</Alert> : null}
      <View style={st.row}>
        <Button title="Save" onPress={onSave} loading={saving} style={st.btn} />
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={st.btn} />
        {onRemove ? <Button title={removeLabel} variant="ghost" onPress={onRemove} style={st.btn} /> : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  box: { backgroundColor: '#fffbeb', borderTopWidth: 1, borderTopColor: '#fde68a', padding: 16, gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  note: { fontSize: 13, color: '#92400e' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  scope: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  scopeOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  scopeText: { fontWeight: '700', color: colors.text, fontSize: 14 },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  segBtn: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  segOn: { backgroundColor: colors.primary },
  segText: { fontWeight: '800', color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, minHeight: 48, fontSize: 16, color: colors.text, backgroundColor: '#fff', outlineStyle: 'none', minWidth: 160 },
  sub: { fontSize: 12.5, color: colors.muted },
  preview: { fontSize: 15, fontWeight: '700', color: colors.success },
  btn: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 14 },
});
