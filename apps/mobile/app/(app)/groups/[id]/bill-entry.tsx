import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useOcrScanner } from '@/hooks/useOcrScanner';
import { useReceiptAsset } from '@/hooks/useReceiptAsset';
import { useFlaggedFields } from '@/hooks/useFlaggedFields';
import type { BillType, CountryCode } from '@split-smart/types';
import type { Country, BillType as OcrBillType } from '@split-smart/ocr-parser';

const BILL_TYPES: { value: BillType; label: string }[] = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'delivery', label: 'Food Delivery' },
  { value: 'grocery', label: 'Grocery' },
  { value: 'utility', label: 'Utility' },
  { value: 'custom', label: 'Custom' },
];

interface LineItemInput {
  name: string;
  quantity: string;
  unitPrice: string;
}

interface ChargeInput {
  label: string;
  amount: string;
  type: 'sales_tax' | 'delivery_fee' | 'service_fee' | 'gratuity' | 'discount';
}

function toExpenseBillType(ocrType: string): BillType {
  const map: Record<string, BillType> = {
    restaurant: 'restaurant', grocery: 'grocery',
    delivery: 'delivery', utility: 'utility',
  };
  return map[ocrType] ?? 'custom';
}

function toOcrBillType(t: BillType): OcrBillType {
  const map: Partial<Record<BillType, OcrBillType>> = {
    restaurant: 'restaurant', grocery: 'grocery',
    delivery: 'delivery', utility: 'utility', custom: 'custom',
  };
  return map[t] ?? 'custom';
}

export default function BillEntryScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [billType, setBillType] = useState<BillType>('restaurant');
  const [items, setItems] = useState<LineItemInput[]>([{ name: '', quantity: '1', unitPrice: '' }]);
  const [charges, setCharges] = useState<ChargeInput[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [country, setCountry] = useState<Country>('US');
  const [loading, setLoading] = useState(false);

  const { state: scanState, scan, reset: resetScan } = useOcrScanner(country, toOcrBillType(billType));
  const { createAsset, markDone, markFailed } = useReceiptAsset();
  const { isFlagged, confirm, reset: resetFlags, flaggedCount } = useFlaggedFields([]);

  useEffect(() => {
    supabase
      .from('groups')
      .select('currency, country')
      .eq('id', groupId)
      .single()
      .then(({ data }) => {
        if (data) {
          setCurrency(data.currency);
          setCountry((data.country as CountryCode) === 'IN' ? 'IN' : 'US');
        }
      });
  }, [groupId]);

  // Pre-fill form from scan draft and seed flagged fields.
  useEffect(() => {
    if (scanState.status !== 'done') return;
    const { draft } = scanState;

    if (draft.merchantName) setTitle(draft.merchantName);
    if (draft.date) setDate(draft.date);
    if (draft.billType) setBillType(toExpenseBillType(draft.billType));

    if (draft.items.length > 0) {
      setItems(draft.items.map((item: { name: string; quantity: number; unitPrice: number }) => ({
        name: item.name,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      })));
    }

    if (draft.charges.length > 0) {
      const chargeTypeMap: Record<string, ChargeInput['type']> = {
        sales_tax: 'sales_tax', state_tax: 'sales_tax', city_tax: 'sales_tax',
        delivery_fee: 'delivery_fee', service_fee: 'service_fee',
        platform_fee: 'service_fee', gratuity: 'gratuity', discount: 'discount',
      };
      setCharges(draft.charges.map((c: { label: string; amount: number; type: string }) => ({
        label: c.label,
        amount: String(c.amount),
        type: chargeTypeMap[c.type] ?? 'service_fee',
      })));
    }

    resetFlags(draft.flaggedFields);
  }, [scanState, resetFlags]);

  useEffect(() => {
    if (scanState.status === 'failed') {
      Alert.alert(
        'Scan failed',
        `${scanState.reason}. You can enter the bill manually.`,
        [{ text: 'OK', onPress: resetScan }]
      );
    }
  }, [scanState, resetScan]);

  const addItem = () => setItems([...items, { name: '', quantity: '1', unitPrice: '' }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof LineItemInput, value: string) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [field]: value };
    setItems(updated);
    confirm('items');
  };

  const addCharge = (type: ChargeInput['type'], label: string) =>
    setCharges([...charges, { label, amount: '', type }]);
  const removeCharge = (i: number) => setCharges(charges.filter((_, idx) => idx !== i));
  const updateChargeAmount = (i: number, amount: string) => {
    const updated = [...charges];
    updated[i] = { ...updated[i], amount };
    setCharges(updated);
    confirm('charges');
  };

  const computeTotal = () => {
    const itemTotal = items.reduce((s, item) => {
      return s + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
    }, 0);
    const chargeTotal = charges.reduce((s, c) => {
      const amt = parseFloat(c.amount) || 0;
      return c.type === 'discount' ? s - amt : s + amt;
    }, 0);
    return itemTotal + chargeTotal;
  };

  async function handleSubmit() {
    const validItems = items.filter((i) => i.name.trim() && parseFloat(i.unitPrice) > 0);
    if (!title.trim()) { Alert.alert('Error', 'Bill title is required'); return; }
    if (validItems.length === 0) { Alert.alert('Error', 'Add at least one item'); return; }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const total = computeTotal();

    const { data: expense, error: expError } = await supabase
      .from('expenses')
      .insert({
        group_id: groupId,
        title: title.trim(),
        total_amount: Math.round(total * 100) / 100,
        currency,
        category: 'food',
        bill_type: billType,
        paid_by: user.id,
        date,
        status: 'active',
        split_method: 'itemized',
        created_by: user.id,
      })
      .select('id')
      .single();

    if (expError || !expense) {
      Alert.alert('Error', expError?.message ?? 'Failed to create bill');
      setLoading(false);
      return;
    }

    if (scanState.status === 'done') {
      const assetId = await createAsset(expense.id, scanState.imageUri, user.id);
      if (assetId) await markDone(assetId, scanState.draft);
    }

    await supabase.from('line_items').insert(
      validItems.map((item, i) => ({
        expense_id: expense.id,
        name: item.name.trim(),
        quantity: parseFloat(item.quantity) || 1,
        unit_price: parseFloat(item.unitPrice),
        total_price: (parseFloat(item.quantity) || 1) * parseFloat(item.unitPrice),
        position: i,
      }))
    );

    const chargeRows = charges
      .filter((c) => parseFloat(c.amount) > 0)
      .map((c, i) => ({
        expense_id: expense.id,
        type: c.type,
        label: c.label,
        amount: c.type === 'discount' ? -parseFloat(c.amount) : parseFloat(c.amount),
        allocation_rule: c.type === 'discount' ? 'equal' : 'proportional_to_subtotal',
        excluded_user_ids: [],
        position: i,
      }));
    if (chargeRows.length > 0) await supabase.from('charge_components').insert(chargeRows);

    const { data: groupMembers } = await supabase
      .from('group_members').select('user_id').eq('group_id', groupId);

    const participantRows = (groupMembers ?? []).map((gm: { user_id: string }) => ({
      expense_id: expense.id,
      user_id: gm.user_id,
      owed_amount: 0,
      paid_amount: gm.user_id === user.id ? total : 0,
      is_included: true,
    }));
    if (participantRows.length > 0) await supabase.from('expense_participants').insert(participantRows);

    setLoading(false);
    router.replace(`/(app)/groups/${groupId}/assign-items?expenseId=${expense.id}`);
  }

  const sym = currency === 'INR' ? '₹' : '$';
  const isScanning = scanState.status === 'picking' || scanState.status === 'processing';
  const wasScanned = scanState.status === 'done';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Scan button */}
      <TouchableOpacity
        style={[styles.scanBtn, isScanning && styles.scanBtnDisabled]}
        onPress={scan}
        disabled={isScanning}
      >
        {isScanning ? (
          <View style={styles.scanBtnInner}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.scanBtnText}>
              {scanState.status === 'picking' ? 'Picking image…' : 'Scanning…'}
            </Text>
          </View>
        ) : (
          <Text style={styles.scanBtnText}>
            {wasScanned ? '📷 Re-scan receipt' : '📷 Scan receipt'}
          </Text>
        )}
      </TouchableOpacity>

      {/* Scan status badge */}
      {wasScanned && (
        <View style={[styles.scanBadge, flaggedCount === 0 && styles.scanBadgeConfirmed]}>
          <Text style={[styles.scanBadgeText, flaggedCount === 0 && styles.scanBadgeTextConfirmed]}>
            {flaggedCount === 0
              ? '✓ All fields confirmed'
              : `${flaggedCount} field${flaggedCount > 1 ? 's' : ''} need review — edit them below`}
          </Text>
        </View>
      )}

      {/* Bill title — flaggable as 'merchantName' */}
      <View style={styles.fieldRow}>
        <Text style={styles.label}>Bill title</Text>
        {isFlagged('merchantName') && <Text style={styles.reviewChip}>Review</Text>}
      </View>
      <TextInput
        style={[styles.input, isFlagged('merchantName') && styles.inputFlagged]}
        placeholder="e.g. Dinner at Mainland China"
        value={title}
        onChangeText={(v) => { setTitle(v); confirm('merchantName'); }}
      />

      {/* Date — flaggable as 'date' */}
      <View style={styles.fieldRow}>
        <Text style={styles.label}>Date</Text>
        {isFlagged('date') && <Text style={styles.reviewChip}>Review</Text>}
      </View>
      <TextInput
        style={[styles.input, isFlagged('date') && styles.inputFlagged]}
        placeholder="YYYY-MM-DD"
        value={date}
        onChangeText={(v) => { setDate(v); confirm('date'); }}
      />

      {/* Bill type */}
      <Text style={styles.label}>Bill type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        <View style={styles.chips}>
          {BILL_TYPES.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.chip, billType === t.value && styles.chipActive]}
              onPress={() => setBillType(t.value)}
            >
              <Text style={[styles.chipText, billType === t.value && styles.chipTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Items — section flaggable as 'items' */}
      <View style={styles.fieldRow}>
        <Text style={styles.sectionTitle}>Items</Text>
        {isFlagged('items') && <Text style={styles.reviewChip}>Review</Text>}
      </View>
      <View style={[styles.section, isFlagged('items') && styles.sectionFlagged]}>
        {items.map((item, i) => (
          <View key={i} style={styles.itemRow}>
            <TextInput
              style={[styles.input, styles.itemName]}
              placeholder="Item name"
              value={item.name}
              onChangeText={(v) => updateItem(i, 'name', v)}
            />
            <TextInput
              style={[styles.input, styles.itemQty]}
              placeholder="Qty"
              keyboardType="numeric"
              value={item.quantity}
              onChangeText={(v) => updateItem(i, 'quantity', v)}
            />
            <TextInput
              style={[styles.input, styles.itemPrice]}
              placeholder={`${sym}0`}
              keyboardType="decimal-pad"
              value={item.unitPrice}
              onChangeText={(v) => updateItem(i, 'unitPrice', v)}
            />
            {items.length > 1 && (
              <TouchableOpacity onPress={() => removeItem(i)} style={styles.removeBtn}>
                <Text style={styles.removeText}>×</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <TouchableOpacity onPress={addItem} style={styles.addBtn}>
          <Text style={styles.addText}>+ Add item</Text>
        </TouchableOpacity>
      </View>

      {/* Charges — section flaggable as 'charges' */}
      <View style={styles.fieldRow}>
        <Text style={styles.sectionTitle}>Charges & Taxes</Text>
        {isFlagged('charges') && <Text style={styles.reviewChip}>Review</Text>}
      </View>
      <View style={[styles.section, isFlagged('charges') && styles.sectionFlagged]}>
        {charges.map((c, i) => (
          <View key={i} style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>{c.label}</Text>
            <TextInput
              style={[styles.input, styles.chargeAmount]}
              placeholder={`${sym}0`}
              keyboardType="decimal-pad"
              value={c.amount}
              onChangeText={(v) => updateChargeAmount(i, v)}
            />
            <TouchableOpacity onPress={() => removeCharge(i)} style={styles.removeBtn}>
              <Text style={styles.removeText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.chargeButtons}>
          <TouchableOpacity style={styles.chargeAddBtn} onPress={() => addCharge('sales_tax', 'Tax')}>
            <Text style={styles.chargeAddText}>+ Tax</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chargeAddBtn} onPress={() => addCharge('delivery_fee', 'Delivery Fee')}>
            <Text style={styles.chargeAddText}>+ Delivery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chargeAddBtn} onPress={() => addCharge('gratuity', 'Tip')}>
            <Text style={styles.chargeAddText}>+ Tip</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chargeAddBtn} onPress={() => addCharge('discount', 'Discount')}>
            <Text style={styles.chargeAddText}>+ Discount</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Total — flaggable as 'total' */}
      <View style={[styles.totalRow, isFlagged('total') && styles.totalRowFlagged]}>
        <View>
          <Text style={styles.totalLabel}>Total</Text>
          {isFlagged('total') && (
            <Text style={styles.totalFlagNote}>Parser was uncertain — verify items & charges</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => confirm('total')} disabled={!isFlagged('total')}>
          <Text style={[styles.totalAmount, isFlagged('total') && styles.totalAmountFlagged]}>
            {sym}{computeTotal().toFixed(2)}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.submitText}>{loading ? 'Saving…' : 'Save Bill'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const FLAGGED_BORDER = '#f59e0b';
const FLAGGED_BG = '#fffbeb';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 40 },

  scanBtn: {
    backgroundColor: '#16a34a', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center', marginBottom: 6,
  },
  scanBtnDisabled: { backgroundColor: '#86efac' },
  scanBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scanBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  scanBadge: {
    backgroundColor: FLAGGED_BG, borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 6, marginBottom: 12, borderWidth: 1, borderColor: FLAGGED_BORDER,
  },
  scanBadgeConfirmed: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  scanBadgeText: { fontSize: 13, color: '#92400e' },
  scanBadgeTextConfirmed: { color: '#15803d' },

  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151' },
  reviewChip: {
    fontSize: 11, fontWeight: '600', color: '#92400e',
    backgroundColor: FLAGGED_BG, borderWidth: 1, borderColor: FLAGGED_BORDER,
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },

  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    backgroundColor: '#fff', color: '#111827',
  },
  inputFlagged: { borderColor: FLAGGED_BORDER, backgroundColor: FLAGGED_BG },

  section: { borderRadius: 10, marginBottom: 4 },
  sectionFlagged: {
    borderWidth: 1.5, borderColor: FLAGGED_BORDER,
    backgroundColor: FLAGGED_BG, borderRadius: 10, padding: 10,
  },

  chipScroll: { marginBottom: 4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#6b7280' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },

  itemRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  itemName: { flex: 3 },
  itemQty: { flex: 1, textAlign: 'center' },
  itemPrice: { flex: 2, textAlign: 'right' },
  removeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center',
  },
  removeText: { color: '#dc2626', fontWeight: '700', fontSize: 15 },
  addBtn: { paddingVertical: 8 },
  addText: { color: '#16a34a', fontWeight: '600', fontSize: 14 },

  chargeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  chargeLabel: { flex: 2, fontSize: 14, color: '#374151' },
  chargeAmount: { flex: 1, textAlign: 'right' },
  chargeButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chargeAddBtn: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff',
  },
  chargeAddText: { fontSize: 13, color: '#6b7280' },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb',
  },
  totalRowFlagged: {
    borderTopColor: FLAGGED_BORDER, backgroundColor: FLAGGED_BG,
    borderRadius: 10, padding: 12, marginTop: 16, borderTopWidth: 0,
    borderWidth: 1.5, borderColor: FLAGGED_BORDER,
  },
  totalLabel: { fontSize: 18, fontWeight: '700', color: '#111827' },
  totalFlagNote: { fontSize: 11, color: '#92400e', marginTop: 2 },
  totalAmount: { fontSize: 22, fontWeight: '700', color: '#16a34a' },
  totalAmountFlagged: { color: FLAGGED_BORDER },

  submitBtn: {
    backgroundColor: '#16a34a', borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 20,
  },
  submitText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
