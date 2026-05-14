import { describe, it, expect } from 'vitest';
import {
  findMatchingTemplate,
  applyChargeDefaults,
  buildSplitOverrides,
  validateTemplate,
} from './templates';
import type { BillRuleTemplate, ChargeComponent } from '@split-smart/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeTemplate = (overrides: Partial<BillRuleTemplate> = {}): BillRuleTemplate => ({
  id: 'tmpl-1',
  groupId: 'grp-1',
  billType: 'utility',
  name: 'Monthly Rent Split',
  rules: {
    splitMethod: 'percentage',
    memberAllocations: {
      'user-A': 40,
      'user-B': 35,
      'user-C': 25,
    },
    chargeDefaults: [
      { chargeType: 'service_fee' as const, allocationRule: 'equal' as const },
    ],
  },
  createdBy: 'user-A',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  ...overrides,
});

// ─── findMatchingTemplate ─────────────────────────────────────────────────────

describe('findMatchingTemplate', () => {
  it('finds a matching template by group and bill type', () => {
    const templates = [
      makeTemplate(),
      makeTemplate({ id: 'tmpl-2', billType: 'subscription', name: 'Netflix' }),
    ];

    const match = findMatchingTemplate(templates, 'grp-1', 'utility');
    expect(match?.id).toBe('tmpl-1');
  });

  it('returns null when no match exists', () => {
    const templates = [makeTemplate()];
    expect(findMatchingTemplate(templates, 'grp-1', 'restaurant')).toBeNull();
    expect(findMatchingTemplate(templates, 'grp-999', 'utility')).toBeNull();
  });
});

// ─── applyChargeDefaults ──────────────────────────────────────────────────────

describe('applyChargeDefaults', () => {
  it('overrides allocation rule for matching charge types', () => {
    const charges: ChargeComponent[] = [
      {
        id: 'c1',
        expenseId: 'exp-1',
        type: 'service_fee',
        label: 'Maintenance Fee',
        amount: 50,
        allocationRule: 'proportional_to_subtotal', // will be overridden
        excludedUserIds: [],
        position: 0,
      },
      {
        id: 'c2',
        expenseId: 'exp-1',
        type: 'sales_tax',
        label: 'Property Tax',
        amount: 20,
        allocationRule: 'proportional_to_subtotal', // not in template — unchanged
        excludedUserIds: [],
        position: 1,
      },
    ];

    const result = applyChargeDefaults(charges, makeTemplate());

    expect(result[0].allocationRule).toBe('equal'); // overridden
    expect(result[1].allocationRule).toBe('proportional_to_subtotal'); // unchanged
  });

  it('returns charges unchanged when template has no charge defaults', () => {
    const charges: ChargeComponent[] = [
      { id: 'c1', expenseId: 'exp-1', type: 'delivery_fee', label: 'Fee', amount: 10, allocationRule: 'equal', excludedUserIds: [], position: 0 },
    ];

    const template = makeTemplate({ rules: { splitMethod: 'equal' } });
    const result = applyChargeDefaults(charges, template);
    expect(result).toEqual(charges);
  });
});

// ─── buildSplitOverrides ──────────────────────────────────────────────────────

describe('buildSplitOverrides', () => {
  it('extracts member allocations from template', () => {
    const overrides = buildSplitOverrides(makeTemplate());
    expect(overrides).toEqual({
      'user-A': 40,
      'user-B': 35,
      'user-C': 25,
    });
  });

  it('returns empty object when no allocations defined', () => {
    const template = makeTemplate({ rules: { splitMethod: 'equal' } });
    expect(buildSplitOverrides(template)).toEqual({});
  });
});

// ─── validateTemplate ─────────────────────────────────────────────────────────

describe('validateTemplate', () => {
  it('returns null for valid percentage template summing to 100', () => {
    expect(validateTemplate(makeTemplate())).toBeNull();
  });

  it('returns error when percentages do not sum to 100', () => {
    const bad = makeTemplate({
      rules: {
        splitMethod: 'percentage',
        memberAllocations: { 'user-A': 50, 'user-B': 30 }, // sums to 80
      },
    });
    const error = validateTemplate(bad);
    expect(error).toContain('100');
    expect(error).toContain('80');
  });

  it('skips validation for non-percentage methods', () => {
    const shares = makeTemplate({
      rules: {
        splitMethod: 'shares',
        memberAllocations: { 'user-A': 3, 'user-B': 2 }, // sums to 5, fine for shares
      },
    });
    expect(validateTemplate(shares)).toBeNull();
  });
});
