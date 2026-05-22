/**
 * The kind of group this is. Matches the CHECK constraint on groups.type
 * in migration 001.
 */
export type GroupType = 'trip' | 'roommates' | 'household' | 'event' | 'other';

/**
 * Country drives tax + parsing mode (India GST vs US sales tax).
 * Matches the CHECK on groups.country in migration 002.
 */
export type Country = 'IN' | 'US';

/**
 * How transfers are computed at settle time.
 * - `optimized`: minimize the number of transfers via min-flow on the debt graph.
 * - `direct`: each debtor pays each creditor exactly what they owe per bill.
 * Matches the CHECK on groups.settlement_mode in migration 002.
 */
export type SettlementMode = 'optimized' | 'direct';

export type GroupMemberRole = 'owner' | 'member';

export type Group = {
  id: string;
  name: string;
  description: string | null;
  type: GroupType;
  currency: string; // ISO 4217 3-letter (e.g. 'USD', 'INR')
  country: Country;
  settlementMode: SettlementMode;
  createdBy: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
};

export type GroupMember = {
  id: string;
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  joinedAt: string;
};
