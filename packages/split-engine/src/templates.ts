/**
 * Bill rule templates. Phase 7 ships the data shape and a no-op apply
 * function; full hydration of saved rules (read from `bill_rule_templates`
 * in the DB) lands when bill-entry needs it in a later phase.
 *
 * Kept minimal here so other engine code can import the type today
 * without us pre-committing to a rule grammar that hasn't been used yet.
 */

import type { ChargeComponent, LineItem, LineItemParticipant } from '@splitmate/types';

export type BillRuleTemplate = {
  id: string;
  groupId: string;
  billType: string;
  name: string;
  rules: Record<string, unknown>;
};

export type BillScaffold = {
  lineItems: LineItem[];
  participants: LineItemParticipant[];
  charges: ChargeComponent[];
};

/**
 * Apply a saved template's rules to a fresh bill scaffold.
 * Phase 7 implementation: passthrough. Future phases will read
 * `template.rules` and populate default item categories, charge
 * allocation overrides, and pre-claimed shares (e.g. "rent 40/40/20").
 */
export function applyTemplate(_template: BillRuleTemplate, scaffold: BillScaffold): BillScaffold {
  return scaffold;
}
