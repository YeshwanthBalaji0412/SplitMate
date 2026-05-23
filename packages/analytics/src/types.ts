import type { SpendingPersonality } from './personality';

/**
 * BillRecord is the analytics input shape. The mobile hook (useBillRecords)
 * maps Supabase rows into this format so the analytics package never
 * touches the database.
 */
export type BillRecord = {
  id: string;
  date: string;         // ISO YYYY-MM-DD
  title: string;
  billType: string;     // restaurant, grocery, delivery, ...
  totalAmount: number;
  currency: string;
  status: string;       // active, settled, archived
  settledAt: string | null;
  participants: Array<{
    userId: string;
    owedAmount: number;
    paidAmount: number;
  }>;
  items: Array<{
    name: string;
    totalPrice: number;
    category: string;
  }>;
};

export type CategoryBreakdown = {
  category: string;
  amount: number;
  percentage: number;
};

export type MonthlyReport = {
  totalSpent: number;
  billCount: number;
  categoryBreakdown: CategoryBreakdown[];
  topCategory: string | null;
  avgDaysToSettle: number | null;
  settlementStreak: number;
  personality: SpendingPersonality | null;
};

export type GroupSnapshot = {
  groupTotalSpend: number;
  userShare: number;
  avgSharePerMember: number;
  memberCount: number;
  topCategory: string | null;
  settlementStreak: number;
};
