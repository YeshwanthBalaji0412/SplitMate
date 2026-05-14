/**
 * Bill Rule Templates — apply saved split rules to new bills automatically.
 *
 * When a group creates a utility or subscription bill, they define split rules
 * once (e.g. "rent split: Alice 40%, Bob 35%, Charlie 25%"). On subsequent
 * bills of the same type, the template is auto-applied — zero re-entry.
 */

import type {
  BillRuleTemplate,
  BillType,
  ChargeComponent,
  AllocationRule,
  ChargeType,
} from '@split-smart/types';

// ─── Template rule schema ────────────────────────────────────────────────────
// The `rules` JSONB in BillRuleTemplate follows this shape:

export interface TemplateRules {
  /** Default split method for the bill */
  splitMethod: 'equal' | 'percentage' | 'shares';
  /** Per-member allocation: userId → percentage or share count */
  memberAllocations?: Record<string, number>;
  /** Default charge allocation rules by charge type */
  chargeDefaults?: Array<{
    chargeType: ChargeType;
    allocationRule: AllocationRule;
    excludedUserIds?: string[];
  }>;
}

/**
 * Match a template for a given group and bill type.
 * Returns the first matching template, or null if none exists.
 */
export function findMatchingTemplate(
  templates: BillRuleTemplate[],
  groupId: string,
  billType: BillType
): BillRuleTemplate | null {
  return templates.find((t) => t.groupId === groupId && t.billType === billType) ?? null;
}

/**
 * Apply a template's charge defaults to a list of charge components.
 * For each charge, if the template has a default for that charge type,
 * override the allocation rule and excluded users.
 * Charges not covered by the template are returned unchanged.
 */
export function applyChargeDefaults(
  charges: ChargeComponent[],
  template: BillRuleTemplate
): ChargeComponent[] {
  const rules = template.rules as TemplateRules;
  if (!rules.chargeDefaults || rules.chargeDefaults.length === 0) return charges;

  const defaultMap = new Map(
    rules.chargeDefaults.map((d) => [d.chargeType, d])
  );

  return charges.map((charge) => {
    const override = defaultMap.get(charge.type);
    if (!override) return charge;

    return {
      ...charge,
      allocationRule: override.allocationRule,
      excludedUserIds: override.excludedUserIds ?? charge.excludedUserIds,
    };
  });
}

/**
 * Build a split rule overrides map from a template's member allocations.
 * Returns a Record<userId, number> suitable for SplitRule.overrides.
 */
export function buildSplitOverrides(
  template: BillRuleTemplate
): Record<string, number> {
  const rules = template.rules as TemplateRules;
  return rules.memberAllocations ?? {};
}

/**
 * Validate that a template's percentage allocations sum to 100.
 * Returns null if valid, or an error message if not.
 */
export function validateTemplate(template: BillRuleTemplate): string | null {
  const rules = template.rules as TemplateRules;

  if (rules.splitMethod === 'percentage' && rules.memberAllocations) {
    const total = Object.values(rules.memberAllocations).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 100) > 0.01) {
      return `Percentage allocations must sum to 100, got ${total.toFixed(2)}`;
    }
  }

  return null;
}
