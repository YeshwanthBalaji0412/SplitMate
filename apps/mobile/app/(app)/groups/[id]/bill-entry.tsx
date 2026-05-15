import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import type { BillType } from '@split-smart/types';

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

export default function BillEntryScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [billType, setBillType] = useState<BillType>('restaurant');
  const [items, setItems] = useState<LineItemInput[]>([{ name: '', quantity: '1', unitPrice: '' }]);
  const [charges, setCharges] = useState<ChargeInput[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch group currency
    supabase.from('groups').select('currency').eq('id', groupId).single()
      .then(({ data }) => { if (data) setCurrency(data.currency); });
  }, [groupId]);

  const addItem = () => setItems([...items, { name: '', quantity: '1', unitPrice: '' }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof LineItemInput, value: string) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [field]: value };
    setItems(updated);
  };

  const addCharge = (type: ChargeInput['type'], label: string) => {
    setCharges([...charges, { label, amount: '', type }]);
  };
  const removeCharge = (i: number) => setCharges(charges.filter((_, idx) => idx !== i));
  const updateChargeAmount = (i: number, amount: string) => {
    const updated = [...charges];
    updated[i] = { ...updated[i], amount };
    setCharges(updated);
  };

  const computeTotal = () => {
    const itemTotal = items.reduce((s, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      return s + qty * price;
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

    // Create expense
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
        date: new Date().toISOString().split('T')[0],
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

    // Insert line items
    const lineItemRows = validItems.map((item, i) => ({
      expense_id: expense.id,
      name: item.name.trim(),
      quantity: parseFloat(item.quantity) || 1,
      unit_price: parseFloat(item.unitPrice),
      total_price: (parseFloat(item.quantity) || 1) * parseFloat(item.unitPrice),
      position: i,
    }));
    await supabase.from('line_items').insert(lineItemRows);

    // Insert charge components
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
    if (chargeRows.length > 0) {
      await supabase.from('charge_components').insert(chargeRows);
    }

    // Add all group members as participants
    const { data: groupMembers } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);

    const participantRows = (groupMembers ?? []).map((gm: any) => ({
      expense_id: expense.id,
      user_id: gm.user_id,
      owed_amount: 0,
      paid_amount: gm.user_id === user.id ? total : 0,
      is_included: true,
    }));

    if (participantRows.length > 0) {
      await supabase.from('expense_participants').insert(participantRows);
    }

    setLoading(false);
    // Go to item assignment screen so users can claim items
    router.replace(`/(app)/groups/${groupId}/assign-items?expenseId=${expense.id}`);
  }

  const sym = currency === 'INR' ? '₹' : '$';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Bill title</Text>
      <TextInput style={styles.input} placeholder="e.g. Dinner at Mainland China" value={title} onChangeText={setTitle} />

      <Text style={styles.label}>Bill type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        <View style={styles.chips}>
          {BILL_TYPES.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.chip, billType === t.value && styles.chipActive]}
              onPress={() => setBillType(t.value)}
            >
              <Text style={[styles.chipText, billType === t.value && styles.chipTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Line Items */}
      <Text style={styles.sectionTitle}>Items</Text>
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
              <Text style={styles.removeText}>x</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <TouchableOpacity onPress={addItem} style={styles.addBtn}>
        <Text style={styles.addText}>+ Add item</Text>
      </TouchableOpacity>

      {/* Charges */}
      <Text style={styles.sectionTitle}>Charges & Taxes</Text>
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
            <Text style={styles.removeText}>x</Text>
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

      {/* Total */}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalAmount}>{sym}{computeTotal().toFixed(2)}</Text>
      </View>

      <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.submitText}>{loading ? 'Saving...' : 'Save Bill'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: '#fff', color: '#111827' },
  chipScroll: { marginBottom: 4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#6b7280' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 24, marginBottom: 10 },
  itemRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  itemName: { flex: 3 },
  itemQty: { flex: 1, textAlign: 'center' },
  itemPrice: { flex: 2, textAlign: 'right' },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#dc2626', fontWeight: '700', fontSize: 13 },
  addBtn: { paddingVertical: 8 },
  addText: { color: '#16a34a', fontWeight: '600', fontSize: 14 },
  chargeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  chargeLabel: { flex: 2, fontSize: 14, color: '#374151' },
  chargeAmount: { flex: 1, textAlign: 'right' },
  chargeButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chargeAddBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  chargeAddText: { fontSize: 13, color: '#6b7280' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  totalLabel: { fontSize: 18, fontWeight: '700', color: '#111827' },
  totalAmount: { fontSize: 22, fontWeight: '700', color: '#16a34a' },
  submitBtn: { backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
