// ─── Input types ──────────────────────────────────────────────────────────────
// Analytics takes bill data already stored locally. These mirror the shapes
// from @split-smart/types but are kept minimal — only what analytics needs.

export type BillCategory =
  | 'restaurant'
  | 'delivery'
  | 'grocery'
  | 'utilities'
  | 'accommodation'
  | 'subscription'
  | 'custom';

export type ItemCategory = 'food' | 'alcohol' | 'non_taxable' | 'other';

export interface BillRecord {
  id: string;
  groupId: string;
  date: string;          // ISO 8601
  billType: BillCategory;
  totalAmount: number;
  currency: string;      // 'INR' | 'USD'
  settledAt: string | null;
  participants: ParticipantRecord[];
  items: ItemRecord[];
}

export interface ParticipantRecord {
  userId: string;
  owedAmount: number;
  paidAmount: number;   // what they actually paid up front (usually 0)
}

export interface ItemRecord {
  name: string;
  totalPrice: number;
  category: ItemCategory;
  claimedByUserIds: string[];  // who claimed this item
}

// ─── Time window ──────────────────────────────────────────────────────────────

export interface TimeWindow {
  from: string;   // ISO 8601 date
  to: string;     // ISO 8601 date
}

// ─── Output types ─────────────────────────────────────────────────────────────

// Category breakdown — how much spent per bill type
export interface CategoryBreakdown {
  billType: BillCategory;
  totalSpent: number;
  billCount: number;
  percentOfTotal: number;
}

// Per-group summary
export interface GroupSummary {
  groupId: string;
  totalSpent: number;       // sum of all bills in this group for the window
  yourShare: number;        // your owed amount across all bills
  billCount: number;
  mostFrequentCategory: BillCategory | null;
}

// Monthly spending report — the main user-facing output
export interface MonthlyReport {
  userId: string;
  window: TimeWindow;
  currency: string;

  // Top-level totals
  totalSpent: number;               // sum of your owed amounts across all bills
  totalBills: number;
  groupsInvolved: number;

  // Category breakdown (sorted by totalSpent desc)
  byCategory: CategoryBreakdown[];

  // Per-group breakdown
  byGroup: GroupSummary[];

  // Fairness signal — are you consistently over/under paying?
  fairnessDelta: number;            // positive = you overpaid, negative = underpaid
  fairnessLabel: 'even' | 'overpaying' | 'underpaying';

  // Settlement behaviour
  avgDaysToSettle: number | null;   // null if no settlements in window
  settlementStreakDays: number;     // consecutive days group settled within 48hrs

  // Spending personality — only populated after 5+ bills total (lifetime)
  spendingPersonality: SpendingPersonality | null;
}

// ─── Spending personality ─────────────────────────────────────────────────────

export type PersonalityType =
  | 'splurger'      // consistently orders the expensive items
  | 'even-steven'   // always splits equally, rarely claims specific items
  | 'optimizer'     // minimises their share, claims cheaper items
  | 'settler';      // pays back fast, reliable

export interface SpendingPersonality {
  type: PersonalityType;
  label: string;         // "The Splurger"
  description: string;   // one sentence, data-backed
  basedOnBills: number;  // how many bills this was derived from
}

// ─── Export format ────────────────────────────────────────────────────────────
// Serialised form for download (JSON) or display (structured text)

export interface AnalyticsExport {
  generatedAt: string;    // ISO 8601 timestamp
  userId: string;
  report: MonthlyReport;
  rawTotals: {
    bills: BillRecord[];  // included for user's own records if they choose
  };
}

// ─── Storage size estimate ────────────────────────────────────────────────────
// Shown to user before they decide to archive

export interface StorageEstimate {
  totalBills: number;
  settledBills: number;
  unsettledBills: number;
  estimatedSizeKB: number;
  archivableAfterDate: string;  // bills settled before this date can be archived
}
