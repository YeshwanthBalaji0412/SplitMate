// ─── Core domain types for Split-Smart ───────────────────────────────────────
// These mirror the database schema exactly. All money values are stored as
// numbers representing the smallest currency unit (cents) but displayed as
// decimals. The split engine works in decimal (JS number) internally.

// ─── User & Auth ─────────────────────────────────────────────────────────────

export interface User {
  id: string; // uuid, maps to auth.users.id in Supabase
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string; // ISO 8601
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export type GroupType = 'trip' | 'roommates' | 'household' | 'event' | 'other';

export interface Group {
  id: string;
  name: string;
  description?: string;
  type: GroupType;
  currency: string; // ISO 4217, e.g. "USD"
  createdBy: string; // userId
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: string;
  user?: User; // populated on joins
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export type ExpenseCategory =
  | 'food'
  | 'drinks'
  | 'transport'
  | 'accommodation'
  | 'groceries'
  | 'utilities'
  | 'entertainment'
  | 'shopping'
  | 'other';

export type ExpenseStatus = 'draft' | 'active' | 'settled';

export interface Expense {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  totalAmount: number; // grand total (after all charges)
  currency: string;
  category: ExpenseCategory;
  paidBy: string; // userId
  date: string; // ISO 8601 date
  receiptAssetId?: string;
  status: ExpenseStatus;
  splitMethod: SplitMethod;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Split Methods ────────────────────────────────────────────────────────────

export type SplitMethod =
  | 'equal'
  | 'exact'
  | 'percentage'
  | 'shares'
  | 'itemized'
  | 'hybrid';

// Per-person record of what they owe for a given expense
export interface ExpenseParticipant {
  id: string;
  expenseId: string;
  userId: string;
  owedAmount: number; // computed by split engine
  paidAmount: number; // what they actually paid (usually 0 unless co-payers)
  isIncluded: boolean; // false = explicitly excluded
  user?: User;
}

// ─── Line Items (for itemized / hybrid splits) ────────────────────────────────

export interface LineItem {
  id: string;
  expenseId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number; // quantity * unitPrice
  position: number; // display order
}

export interface LineItemParticipant {
  id: string;
  lineItemId: string;
  userId: string;
  shares: number; // default 1; used for unequal portion sizes
}

// ─── Charge Components (tax, fee, tip, discount, etc.) ───────────────────────

export type ChargeType =
  | 'subtotal'
  | 'sales_tax'
  | 'state_tax'
  | 'city_tax'
  | 'delivery_fee'
  | 'service_fee'
  | 'platform_fee'
  | 'gratuity'
  | 'discount'
  | 'rounding_adjustment'
  | 'custom';

export type AllocationRule =
  | 'equal' // split evenly among included members
  | 'proportional_to_subtotal' // each person's share ∝ their item subtotal
  | 'proportional_to_selected_items' // ∝ items that have this charge applied
  | 'custom_fixed_amount' // each member pays a fixed override
  | 'excluded'; // nobody pays (e.g., merchant-absorbed discount)

export interface ChargeComponent {
  id: string;
  expenseId: string;
  type: ChargeType;
  label: string; // human-readable, e.g. "CA Sales Tax (8.5%)"
  amount: number; // absolute dollar amount
  rate?: number; // optional %, e.g. 0.085 for 8.5%
  allocationRule: AllocationRule;
  excludedUserIds: string[]; // members excluded from this charge
  position: number;
}

// ─── Split Rules (persisted config driving the split engine) ─────────────────

export interface SplitRule {
  id: string;
  expenseId: string;
  method: SplitMethod;
  // For equal/exact/percentage/shares: per-user overrides
  overrides: Record<string, number>; // userId → amount or %
}

// ─── Settlement ──────────────────────────────────────────────────────────────

export type SettlementStatus = 'pending' | 'completed' | 'cancelled';

export interface Settlement {
  id: string;
  groupId: string;
  fromUserId: string; // who pays
  toUserId: string; // who receives
  amount: number;
  currency: string;
  status: SettlementStatus;
  notes?: string;
  settledAt?: string;
  createdAt: string;
}

// ─── Receipt Asset ────────────────────────────────────────────────────────────

export interface ReceiptAsset {
  id: string;
  expenseId: string;
  storagePath: string; // Supabase storage path
  mimeType: string;
  sizeBytes: number;
  parsedAt?: string; // when OCR completed (Sruthi's domain)
  parseStatus?: 'pending' | 'processing' | 'done' | 'failed';
  uploadedBy: string;
  createdAt: string;
}

// ─── Expense Revision (audit trail) ──────────────────────────────────────────

export interface ExpenseRevision {
  id: string;
  expenseId: string;
  revision: number;
  snapshot: Expense; // full snapshot at time of change
  changedBy: string;
  changedAt: string;
  changeNote?: string;
}

// ─── Split Engine I/O types ───────────────────────────────────────────────────

export interface SplitInput {
  expense: Expense;
  lineItems: LineItem[];
  lineItemParticipants: LineItemParticipant[];
  chargeComponents: ChargeComponent[];
  splitRule: SplitRule;
  participants: ExpenseParticipant[];
}

export interface PersonBreakdown {
  userId: string;
  itemSubtotal: number;
  chargeBreakdown: Array<{
    chargeId: string;
    label: string;
    type: ChargeType;
    amount: number;
  }>;
  totalOwed: number;
  explanation: string; // human-readable explanation
}

export interface SplitResult {
  expenseId: string;
  totalVerified: number; // sum of all person totals (should equal expense.totalAmount)
  roundingRemainder: number; // any rounding difference, absorbed into largest payer
  breakdown: PersonBreakdown[];
  settlementGraph: Array<{
    fromUserId: string;
    toUserId: string;
    amount: number;
  }>;
}

// ─── API Response wrappers ────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiError {
  data: null;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
