import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AllocationRule, BillType, ChargeType } from '@splitmate/types';
import { formatAmount } from '@splitmate/split-engine';
import { useAuth } from '@/hooks/useAuth';
import { createBill, type BillChargeInput, type BillItemInput } from '@/hooks/useBills';
import { useGroup, useGroupMembers } from '@/hooks/useGroups';

// Phase 13 (MLE) will attach the OCR scan button here; for now it's a manual form.
// The form state shape (items[], charges[], includedUserIds, paidBy) is the
// hook point: when OCR lands, it pre-fills these arrays before the user reviews.

const BILL_TYPES: Array<{ value: BillType; label: string }> = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'grocery', label: 'Grocery' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'utility', label: 'Utility' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'accommodation', label: 'Lodging' },
  { value: 'custom', label: 'Other' },
];

const CHARGE_TYPE_OPTIONS: Array<{ value: ChargeType; label: string; defaultRule: AllocationRule }> = [
  { value: 'tax', label: 'Tax', defaultRule: 'proportional_subtotal' },
  { value: 'tip', label: 'Tip', defaultRule: 'proportional_subtotal' },
  { value: 'service', label: 'Service', defaultRule: 'proportional_subtotal' },
  { value: 'delivery', label: 'Delivery fee', defaultRule: 'proportional_order_value' },
  { value: 'platform', label: 'Platform fee', defaultRule: 'equal_per_person' },
  { value: 'surge', label: 'Surge', defaultRule: 'equal_per_person' },
  { value: 'discount', label: 'Discount', defaultRule: 'equal_per_person' },
  { value: 'bag_fee', label: 'Bag fee', defaultRule: 'equal_per_person' },
  { value: 'other', label: 'Other', defaultRule: 'equal_per_person' },
];

type ItemRow = { key: string; name: string; quantity: string; unitPrice: string };
type ChargeRow = {
  key: string;
  type: ChargeType;
  label: string;
  amount: string;
  allocationRule: AllocationRule;
};

function genKey() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyItem(): ItemRow {
  return { key: genKey(), name: '', quantity: '1', unitPrice: '' };
}

function emptyCharge(): ChargeRow {
  return {
    key: genKey(),
    type: 'tax',
    label: 'Tax',
    amount: '',
    allocationRule: 'proportional_subtotal',
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseNum(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export default function BillEntryScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = params.id;
  const { user } = useAuth();
  const { group } = useGroup(groupId);
  const { members } = useGroupMembers(groupId);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [billType, setBillType] = useState<BillType>('restaurant');
  const [items, setItems] = useState<ItemRow[]>([emptyItem()]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [includedUserIds, setIncludedUserIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial selection: include all members, payer defaults to current user.
  const initialized = members.length > 0 && includedUserIds.size === 0;
  if (initialized) {
    setIncludedUserIds(new Set(members.map((m) => m.userId)));
    if (!paidBy && user) setPaidBy(user.id);
  }

  const total = useMemo(() => {
    const itemSum = items.reduce((s, i) => s + parseNum(i.quantity) * parseNum(i.unitPrice), 0);
    const chargeSum = charges.reduce((s, c) => {
      const mag = Math.abs(parseNum(c.amount));
      return c.type === 'discount' ? s - mag : s + mag;
    }, 0);
    return Math.round((itemSum + chargeSum) * 100) / 100;
  }, [items, charges]);

  function updateItem(key: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }
  function updateCharge(key: string, patch: Partial<ChargeRow>) {
    setCharges((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }
  function removeCharge(key: string) {
    setCharges((prev) => prev.filter((c) => c.key !== key));
  }
  function toggleIncluded(uid: string) {
    setIncludedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    if (!groupId || !group || !paidBy) {
      setError('Pick a payer to continue.');
      return;
    }
    if (!includedUserIds.has(paidBy)) {
      setError('Payer must be on the bill.');
      return;
    }

    const cleanItems: BillItemInput[] = items
      .map((it) => ({
        name: it.name.trim() || 'Item',
        quantity: parseNum(it.quantity) || 1,
        unitPrice: parseNum(it.unitPrice),
      }))
      .filter((it) => it.unitPrice > 0);

    const cleanCharges: BillChargeInput[] = charges
      .map((c) => ({
        type: c.type,
        label: c.label.trim() || c.type,
        amount: parseNum(c.amount),
        allocationRule: c.allocationRule,
      }))
      .filter((c) => Math.abs(c.amount) > 0);

    if (cleanItems.length === 0 && cleanCharges.length === 0) {
      setError('Add at least one item or charge with a non-zero amount.');
      return;
    }

    setSubmitting(true);
    const result = await createBill({
      groupId,
      title: title.trim(),
      date,
      billType,
      paidBy,
      currency: group.currency,
      items: cleanItems,
      charges: cleanCharges,
      includedUserIds: Array.from(includedUserIds),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace({
      pathname: '/(app)/groups/[id]/assign-items',
      params: { id: groupId, expenseId: result.expenseId },
    });
  }

  if (!group) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const currency = group.currency;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'New bill' }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Basics */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Title</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Dinner at Olive"
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              editable={!submitting}
            />

            <Text style={styles.sectionLabel}>Date</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              value={date}
              onChangeText={setDate}
              editable={!submitting}
              autoCapitalize="none"
            />

            <Text style={styles.sectionLabel}>Bill type</Text>
            <View style={styles.chipRow}>
              {BILL_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  style={[styles.chip, billType === t.value && styles.chipActive]}
                  onPress={() => setBillType(t.value)}
                  disabled={submitting}
                >
                  <Text style={[styles.chipText, billType === t.value && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Items */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Items</Text>
              <Pressable
                style={styles.linkBtn}
                onPress={() => setItems((p) => [...p, emptyItem()])}
                disabled={submitting}
              >
                <Text style={styles.linkBtnText}>+ Add</Text>
              </Pressable>
            </View>
            {items.length === 0 ? (
              <Text style={styles.sectionHint}>No items yet.</Text>
            ) : (
              items.map((it) => (
                <View key={it.key} style={styles.itemRow}>
                  <TextInput
                    style={[styles.itemInputName]}
                    placeholder="Item name"
                    placeholderTextColor="#9ca3af"
                    value={it.name}
                    onChangeText={(v) => updateItem(it.key, { name: v })}
                    editable={!submitting}
                  />
                  <TextInput
                    style={styles.itemInputQty}
                    placeholder="Qty"
                    placeholderTextColor="#9ca3af"
                    keyboardType="decimal-pad"
                    value={it.quantity}
                    onChangeText={(v) => updateItem(it.key, { quantity: v })}
                    editable={!submitting}
                  />
                  <TextInput
                    style={styles.itemInputPrice}
                    placeholder="Price"
                    placeholderTextColor="#9ca3af"
                    keyboardType="decimal-pad"
                    value={it.unitPrice}
                    onChangeText={(v) => updateItem(it.key, { unitPrice: v })}
                    editable={!submitting}
                  />
                  <Pressable
                    style={styles.removeBtn}
                    onPress={() => removeItem(it.key)}
                    disabled={submitting}
                  >
                    <Text style={styles.removeBtnText}>×</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>

          {/* Charges */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Charges &amp; taxes</Text>
              <Pressable
                style={styles.linkBtn}
                onPress={() => setCharges((p) => [...p, emptyCharge()])}
                disabled={submitting}
              >
                <Text style={styles.linkBtnText}>+ Add</Text>
              </Pressable>
            </View>
            {charges.length === 0 ? (
              <Text style={styles.sectionHint}>No taxes, tips, or fees added.</Text>
            ) : (
              charges.map((c) => (
                <View key={c.key} style={styles.chargeRow}>
                  <View style={styles.chargeTypeRow}>
                    {CHARGE_TYPE_OPTIONS.map((opt) => (
                      <Pressable
                        key={opt.value}
                        style={[styles.chip, c.type === opt.value && styles.chipActive]}
                        onPress={() =>
                          updateCharge(c.key, {
                            type: opt.value,
                            label: opt.label,
                            allocationRule: opt.defaultRule,
                          })
                        }
                        disabled={submitting}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            c.type === opt.value && styles.chipTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.chargeInputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Amount"
                      placeholderTextColor="#9ca3af"
                      keyboardType="decimal-pad"
                      value={c.amount}
                      onChangeText={(v) => updateCharge(c.key, { amount: v })}
                      editable={!submitting}
                    />
                    <Pressable
                      style={styles.removeBtn}
                      onPress={() => removeCharge(c.key)}
                      disabled={submitting}
                    >
                      <Text style={styles.removeBtnText}>×</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Members */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Who's on this bill?</Text>
            <Text style={styles.sectionHint}>Tap to toggle. The payer must be included.</Text>
            <View style={{ marginTop: 8, gap: 8 }}>
              {members.map((m) => {
                const isIncluded = includedUserIds.has(m.userId);
                const isPayer = paidBy === m.userId;
                const name = m.profile?.displayName ?? m.profile?.email ?? 'Unknown';
                return (
                  <View key={m.userId} style={styles.memberRow}>
                    <Pressable
                      style={[styles.memberToggle, isIncluded && styles.memberToggleOn]}
                      onPress={() => toggleIncluded(m.userId)}
                      disabled={submitting}
                    >
                      <Text
                        style={[styles.memberToggleText, isIncluded && styles.memberToggleTextOn]}
                      >
                        {isIncluded ? '✓ ' : ''}
                        {name}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.payerToggle, isPayer && styles.payerToggleOn]}
                      onPress={() => setPaidBy(m.userId)}
                      disabled={submitting || !isIncluded}
                    >
                      <Text style={[styles.payerToggleText, isPayer && styles.payerToggleTextOn]}>
                        {isPayer ? '· paid' : 'mark paid'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Total */}
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatAmount(total, currency)}</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              (submitting || pressed) && styles.primaryBtnPressed,
            ]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryBtnText}>Save &amp; assign items</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scroll: { padding: 16, gap: 12 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#111111' },
  sectionHint: { fontSize: 13, color: '#6b7280' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  linkBtnText: { color: '#16a34a', fontWeight: '600' },

  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111111',
    backgroundColor: '#ffffff',
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#ffffff', fontWeight: '600' },

  itemRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  itemInputName: {
    flex: 2,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111111',
  },
  itemInputQty: {
    flex: 0.5,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111111',
    textAlign: 'center',
  },
  itemInputPrice: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111111',
    textAlign: 'right',
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  removeBtnText: { fontSize: 18, color: '#6b7280' },

  chargeRow: { gap: 8 },
  chargeTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chargeInputRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberToggle: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
  },
  memberToggleOn: { backgroundColor: '#f0fdf4', borderColor: '#16a34a' },
  memberToggleText: { color: '#6b7280' },
  memberToggleTextOn: { color: '#111111', fontWeight: '600' },
  payerToggle: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  payerToggleOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  payerToggleText: { color: '#6b7280', fontSize: 12 },
  payerToggleTextOn: { color: '#ffffff', fontWeight: '600' },

  totalCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { color: '#9ca3af', fontSize: 14 },
  totalAmount: { color: '#ffffff', fontSize: 22, fontWeight: '700' },

  error: { color: '#dc2626', fontSize: 14, textAlign: 'center' },

  primaryBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
