import type { BillRecord, SpendingPersonality, PersonalityType } from './types';

export const MIN_BILLS_FOR_PERSONALITY = 5;

export function derivePersonality(
  userId: string,
  bills: BillRecord[]
): SpendingPersonality | null {
  const userBills = bills.filter((b) =>
    b.participants.some((p) => p.userId === userId)
  );

  if (userBills.length < MIN_BILLS_FOR_PERSONALITY) return null;

  // ─── Scoring dimensions ───────────────────────────────────────────────────

  const groupAvgOwed = userBills.map((b) => {
    const included = b.participants.filter((p) => p.owedAmount > 0);
    return included.length > 0 ? b.totalAmount / included.length : 0;
  });

  const userOwed = userBills.map((b) =>
    b.participants.find((p) => p.userId === userId)?.owedAmount ?? 0
  );

  // Splurge score: user's avg owed / group avg owed
  const meanGroupAvg = groupAvgOwed.reduce((s, v) => s + v, 0) / groupAvgOwed.length;
  const meanUserOwed = userOwed.reduce((s, v) => s + v, 0) / userOwed.length;
  const splurgeScore = meanGroupAvg > 0 ? meanUserOwed / meanGroupAvg : 1;

  // Equal-split score: % of bills where user claimed no specific items
  const equalSplitCount = userBills.filter((b) => b.items.every(
    (item) => item.claimedByUserIds.length === 0 || item.claimedByUserIds.includes(userId) === false
  )).length;
  const equalSplitScore = equalSplitCount / userBills.length;

  // Fairness score: how close to equal share (1 = perfectly even)
  const fairnessDeltas = userBills.map((b, i) => Math.abs(userOwed[i] - groupAvgOwed[i]));
  const meanDelta = fairnessDeltas.reduce((s, v) => s + v, 0) / fairnessDeltas.length;
  const fairnessScore = meanGroupAvg > 0 ? Math.max(0, 1 - meanDelta / meanGroupAvg) : 1;

  // Speed score: settlement speed — lower days = higher score
  const settledBills = userBills.filter((b) => b.settledAt !== null);
  const avgDays = settledBills.length > 0
    ? settledBills.reduce((s, b) => {
        const days = Math.round(
          (new Date(b.settledAt!).getTime() - new Date(b.date).getTime()) / (1000 * 60 * 60 * 24)
        );
        return s + days;
      }, 0) / settledBills.length
    : 7; // default 7 days if no settlements yet
  const speedScore = Math.max(0, 1 - avgDays / 14); // 0 days = 1.0, 14+ days = 0.0

  // ─── Personality assignment ───────────────────────────────────────────────

  const scores: Record<PersonalityType, number> = {
    splurger: splurgeScore > 1.2 ? splurgeScore - 1 : 0,
    'even-steven': equalSplitScore,
    optimizer: splurgeScore < 0.8 ? (1 - splurgeScore) + (1 - fairnessScore) : 0,
    settler: speedScore * fairnessScore,
  };

  const dominant = (Object.entries(scores) as [PersonalityType, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  const labels: Record<PersonalityType, { label: string; description: string }> = {
    splurger: {
      label: 'The Splurger',
      description: `You tend to order more than the group average — your share is usually higher than a straight split.`,
    },
    'even-steven': {
      label: 'The Even-Steven',
      description: `You rarely claim specific items — you're happy to split everything equally and keep it simple.`,
    },
    optimizer: {
      label: 'The Optimizer',
      description: `You're mindful about what you order — your share tends to come in below the group average.`,
    },
    settler: {
      label: 'The Settler',
      description: `You pay back fast and keep your balance close to zero — your group can count on you.`,
    },
  };

  return {
    type: dominant,
    ...labels[dominant],
    basedOnBills: userBills.length,
  };
}
