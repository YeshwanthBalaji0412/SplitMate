# SWE Engineering Log — SplitMate

**Owner:** SWE Lead
**Scope:** Architecture, frontend, backend, split engine, fee rule engine, settlement optimizer
**Roadmap reference:** [PLAN.md](PLAN.md)

---

## Where to Start — MVP Priorities

Work in this order. Schema gaps are blockers for MLE — resolve those first.

### 1. Schema Gaps — Blockers Before Any Feature Work

Six issues identified in the current `dev` schema that block MLE and core features. Fix these before building UI:

| Gap | What's needed | Why it's a blocker |
|---|---|---|
| No `country` on `groups` | Add `country CHAR(2)` enum `IN\|US` | Tax rule engine and OCR parsing mode both need this |
| No `bill_type` on `expenses` | Add `bill_type` enum distinct from `category` | Drives fee rule templates and OCR mode |
| No `input_source` on `expenses` | Add `input_source` enum `ocr\|manual\|upload` | MLE needs this to track pipeline performance |
| No `parse_metadata` on `receipt_assets` | Add `parse_metadata JSONB` | OCR confidence scores and flagged fields land here |
| No settlement traceability | Add `settlement_expense_links` junction table | "You owe X from these bills" is impossible without it |
| `buildExplanation` hardcodes `$` | Make currency-aware | Breaks entirely for INR |

### 2. Fee Rule Engine — Enforce Discount Order-of-Ops
Current engine applies charges by `position` order. This is not enough — discount ordering must be enforced in code regardless of position:

```
1. Item subtotals (from assignment)
2. Discounts → applied to base, reduces what tax is calculated on
3. Taxes → on post-discount base
4. Fees → flat or proportional depending on type
```

Update `computeSplit` in `engine.ts` to enforce this sequence explicitly.

### 3. Settlement Minimization Toggle
Current `minimizeSettlements` always runs. Add group-level toggle:
- **Optimized** (default): run minimizer, trace each transfer back to source expenses via `settlement_expense_links`
- **Direct**: skip minimizer, each person pays exactly who they owe per expense

### 4. Mobile App — React Native + Expo
MVP is mobile-only (Android + iOS). Web app is post-MVP.

Build order within mobile:
1. Auth + group creation + invite code join
2. Bill entry form (manual) for Restaurant and Food Delivery types first — highest frequency
3. Swipe-to-claim item assignment UX
4. Per-person explainability view
5. Settlement view with traceability
6. Photo upload → OCR draft review UX (coordinate schema with Sruthi)
7. Grocery and Utilities bill types + utility rule templates

### 5. Utility Rule Templates
Users set split rules once per group for utility bills — stored as a template, applied automatically on new bills of that type. Needs a `bill_rule_templates` table:
- `group_id`, `bill_type`, `rules JSONB`, `created_by`, `created_at`

---

---

## Responsibilities

- System architecture and data model design
- Split engine: deterministic, rule-based, fully auditable
- Fee rule engine: per-fee-type allocation strategies, country-aware
- Settlement optimizer: debt graph simplification
- Frontend (Next.js web, React Native mobile)
- Backend (Supabase: Postgres, Auth, Storage)
- MLE interface contract: defines schema that OCR pipeline must emit

---

## Design Decisions

### 2026-05-10 — Split engine is rule-based, not ML

**Decision:** The core split calculation is deterministic and rule-based. ML is never used for the split math itself.

**Why:** Users must be able to audit every number. "The model said so" is not an acceptable explanation for a financial calculation. Rules are inspectable, testable, and explainable. ML lives in the data layer (OCR, classification, insights) — never in the money layer.

---

### 2026-05-10 — Per-person explainability is a first-class output, not a view

**Decision:** The split engine produces a structured per-person breakdown as its primary output. The UI renders this — it does not compute it.

**Why:** If explainability is derived in the UI layer, it will drift from the actual calculation over time and be hard to test. The engine owns the math and the explanation. The UI just displays.

**Output format per person:**
```
{
  "user_id": "...",
  "total_owed": 1840,
  "currency": "INR",
  "line_items": [
    { "description": "Margherita Pizza (1/2 share)", "amount": 700 },
    { "description": "Garlic Bread (sole)", "amount": 400 },
    { "description": "GST @ 5% on your items", "amount": 55 },
    { "description": "Service charge (proportional)", "amount": 85 }
  ]
}
```

---

### 2026-05-10 — Fee rule engine is configurable per bill type

**Decision:** Each fee type has a default allocation strategy, which can be overridden per bill. Strategies: proportional to order value, proportional to taxable subtotal, equal per person, flat per person, item-specific.

**Why:** A delivery fee should be split proportional to what you ordered — not equally. An alcohol tax should only apply to alcohol buyers. One-size-fits-all allocation is what every competitor does and it's wrong.

---

### 2026-05-10 — Group currency is set at creation, no cross-currency mixing

**Decision:** A group is either INR or USD. Set at group creation, cannot be changed. No multi-currency bills within one group.

**Why:** Cross-currency splitting requires exchange rate handling, rate-at-time-of-transaction storage, and introduces significant complexity and dispute surface. Out of scope for India + USA focused launch. Keep the system honest about what it handles.

---

### 2026-05-10 — Utility and subscription bills use pre-set rule templates

**Decision:** For recurring bill types (utilities, subscriptions), users define split rules once per group. When a new bill of that type is added, rules are applied automatically with zero re-entry.

**Why:** A utility bill split by room percentage never changes. Asking users to re-enter the split rule every month is unnecessary friction — it's the kind of thing that makes people abandon the app. Templates reduce entry to: amount + date.

---

## Open Questions

- [ ] Local-first vs Supabase-primary: decision needed — SQLite local with optional Supabase sync, or Supabase as primary with offline cache?
- [ ] Settlement optimizer: how to handle partial settlements (paying off one bill from a multi-bill debt)?
- [ ] Bill schema versioning: how do we handle schema evolution without breaking existing stored bills?

---

## Release Log

| Date | Update |
|---|---|
| 2026-05-10 | SWE scope defined, core architectural decisions logged |
