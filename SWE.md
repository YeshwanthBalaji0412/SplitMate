# SWE Engineering Log — SplitMate

**Owner:** SWE Lead
**Scope:** Architecture, frontend, backend, split engine, fee rule engine, settlement optimizer

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
