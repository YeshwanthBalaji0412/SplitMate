# TRACKER — Start Here

> **Read this first, every session.** Everything else is reference material. This file tells you where things stand, what to do next, and where to look if you need more detail.

*Last updated: 2026-05-20*

---

## Document Map

| File | What it is | When to read it |
|---|---|---|
| **TRACKER.md** (this file) | Live project status, next actions, doc index | Every session — start here |
| [README.md](README.md) | Product pitch, tech stack, what makes it different | Sharing the project or onboarding someone new |
| [PLAN.md](PLAN.md) | Full product roadmap — MVP/V1/V2 features, rationale, open decisions | Deciding what to build next or why something exists |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Storage model, key tradeoffs, system design decisions | Before making any architectural decision |
| [MLE.md](MLE.md) | OCR pipeline, analytics — implementation log, module specs, design decisions | Working on anything in `packages/ocr-parser` or `packages/analytics` or MLE mobile hooks |
| [SWE.md](SWE.md) | Split engine, schema, mobile app — implementation log, design decisions | Working on anything in `packages/split-engine`, `packages/types`, `apps/mobile`, or `supabase/` |

---

## Overall Status — 2026-05-18

### What's on main

| Area | What was built | Merged |
|---|---|---|
| Schema | Initial schema (001) + SWE fixes (002): `country`, `bill_type`, `settlement_expense_links`, `bill_rule_templates`, `settlement_mode` | 2026-05-18 |
| Types | Full `@split-smart/types` package — domain types, split engine I/O, settlement traceability | 2026-05-18 |
| Split engine | `engine.ts` + `settlement.ts` + `templates.ts` — deterministic, rule-based, tested | 2026-05-18 |
| OCR parser | 3-stage pipeline: classifier → extractor → parser. 91 tests, 7 real receipts | 2026-05-18 |
| Analytics | Aggregator, spending personality, storage manager, report exporter. 53 tests | 2026-05-18 |
| ML Kit integration | `useOcrScanner` + `useReceiptAsset` — photo → ML Kit → `parseReceipt` → pre-filled bill form | 2026-05-18 |
| Confidence correction UX | `useFlaggedFields` — amber highlights on low-confidence fields, live countdown badge | 2026-05-18 |
| SQLite query layer | `useBillRecords` — Supabase fetch → `BillRecord[]` → `computeMonthlyReport` → report screen | 2026-05-18 |
| Mobile app | Full Expo screen skeleton: auth, dashboard, group create/join, bill entry, item assign, explainability, settlement, report | 2026-05-18 |

---

## MLE — Sruthi

### All MVP modules complete ✅

| # | Module | Package / Location | Tests | Merged |
|---|---|---|---|---|
| 1 | Item classifier + field extractor + receipt parser | `packages/ocr-parser` | 91 + 7 receipts | 2026-05-14 |
| 2 | Analytics aggregator + fairness + settlement streak | `packages/analytics` | 32 | 2026-05-14 |
| 3 | Spending personality + storage manager + report exporter | `packages/analytics` | 21 | 2026-05-18 |
| 4 | ML Kit integration — scan → pre-fill bill entry | `apps/mobile/src/hooks/useOcrScanner.ts` | — | 2026-05-18 |
| 5 | Confidence correction UX — flagged field highlights | `apps/mobile/src/hooks/useFlaggedFields.ts` | — | 2026-05-18 |
| 6 | SQLite query layer + monthly report screen | `apps/mobile/src/hooks/useBillRecords.ts` + `apps/mobile/app/(app)/report.tsx` | — | 2026-05-18 |

### V1 MLE modules

| # | Module | Location | Status |
|---|---|---|---|
| V1-1 | Group Financial Snapshot screen | `apps/mobile/src/hooks/useGroupStats.ts` + `apps/mobile/app/(app)/groups/[id]/group-stats.tsx` | ✅ 2026-05-20 |
| V1-2 | Spending Personality enhancements — shareability + dashboard surface | `apps/mobile/app/(app)/report.tsx` + `apps/mobile/app/(app)/dashboard.tsx` | ✅ 2026-05-20 |
| V1-3 | Fairness Tracking — 8-bill gate + private framing | `apps/mobile/app/(app)/report.tsx` | ⏳ |
| V1-4 | Item category write-back — OCR classifier output → `line_items.category` | Blocked on SWE column | ⏳ |
| V1-5 | OCR Confidence Improvements | `packages/ocr-parser` | ⏳ |

> **Decisions made (2026-05-20):** PDF upload moved to V2 (target crowd uses screenshots and camera; good-to-have later). Anomaly detection moved to V2 — needs 15–20+ bill history baseline before alerts are signal not noise; PLAN.md V2 placement was correct.

### Next actions for Sruthi

MVP schema items (unblocked when SWE adds columns):
- Update `useBillRecords` to use `expenses.settled_at` instead of `updated_at` proxy — one line change
- Update `useBillRecords` to read `line_items.category` for per-item tax analytics — one field addition in the map
- Add more real receipt fixtures to `packages/ocr-parser/src/fixtures/` as edge cases are found in testing

**V1 next up:** Fairness Tracking UI (V1-3) — `fairnessDelta` already computed in `computeMonthlyReport`, needs 8-bill gate + private framing in `report.tsx`.

---

## SWE — Yeshwanth

### MVP in progress

| Area | Status | Notes |
|---|---|---|
| Schema migrations 001 + 002 | ✅ Complete | Both on main |
| `@split-smart/types` | ✅ Complete | Full domain types |
| Split engine | ✅ Complete | `engine.ts`, `settlement.ts`, `templates.ts` |
| Mobile app screens | ✅ Skeleton complete | Auth, dashboard, groups, bill entry, assign, explainability, settlement, report |
| Supabase Storage upload for receipts | ⚠️ Pending | `receipt_assets.storage_path` is a local URI placeholder — needs real upload |
| `expenses.settled_at` column | ⚠️ Pending | MLE uses `updated_at` as proxy — inaccurate if expense is edited after settling |
| `line_items.category` column | ⚠️ Pending | MLE defaults all items to `'other'` — blocks per-item tax allocation in analytics |
| Split engine wired into bill flow | ⏳ Not started | `computeSplit` needs to run after item assignment, write `owed_amount` to `expense_participants` |
| Settlement optimizer wired to settlement screen | ⏳ Not started | `minimizeSettlements` result needs to populate settlement view |
| Discount order-of-ops enforcement | ⏳ Not started | Currently charges applied by position — need discount → tax → fee sequence enforced |

### Next actions for Yeshwanth — next session

**Priority 1 — unblock MLE accuracy (quick schema changes):**
```sql
-- Add to migration 003
ALTER TABLE expenses ADD COLUMN settled_at TIMESTAMPTZ;
ALTER TABLE line_items ADD COLUMN category TEXT NOT NULL DEFAULT 'other'
  CHECK (category IN ('food', 'alcohol', 'non_taxable', 'other'));
```
Update `expense_status` trigger: set `settled_at = NOW()` when status changes to `'settled'`.

**Priority 2 — wire split engine into bill flow:**
- After item assignment confirmed → call `computeSplit` with expense + line items + charges + participants
- Write result `breakdown[i].totalOwed` → `expense_participants.owed_amount`
- This makes the explainability view show real numbers, not zeros

**Priority 3 — Supabase Storage upload:**
- In `useReceiptAsset.createAsset`, upload image to Supabase Storage before inserting the row
- Update `storage_path` to the storage key, not the local URI

---

## Completion Roadmap

### MVP — done when: a real group splits a real delivery receipt end-to-end and settles with full traceability

| Milestone | Status |
|---|---|
| Product vision + architecture | ✅ 2026-05-10 |
| Data schema (001 + 002) | ✅ 2026-05-18 |
| Split engine (deterministic, tested) | ✅ 2026-05-18 |
| OCR pipeline (classify → extract → parse) | ✅ 2026-05-18 |
| Analytics Layer 2 (aggregator, personality, storage, export) | ✅ 2026-05-18 |
| ML Kit scan → bill entry pre-fill | ✅ 2026-05-18 |
| Confidence correction UX | ✅ 2026-05-18 |
| Monthly report screen | ✅ 2026-05-18 |
| Mobile app screen skeleton | ✅ 2026-05-18 |
| Split engine wired into bill flow | ⏳ SWE — next |
| Settlement optimizer wired to settlement screen | ⏳ SWE |
| Supabase Storage upload for receipts | ⏳ SWE |
| Schema: `settled_at`, `line_items.category` | ⏳ SWE |
| Real-device QA on Android + iOS | ⏳ Both |

### V1 — done when: a 6-week-old user gets a genuinely useful spending insight

| Feature | Status |
|---|---|
| Group Financial Snapshot screen | ✅ 2026-05-20 |
| Spending personality — shareability + dashboard surface | ⏳ Next |
| Fairness tracking surfaced in UI (8-bill gate) | ⏳ |
| Storage management (archive eligible bills) | ⏳ |
| Accommodation + subscription bill types | ⏳ SWE |
| PDF upload | Moved to V2 — target crowd uses screenshots/camera; good-to-have |

### V2 — done when: the app proactively surfaces something a user didn't know to ask for

- Anomaly detection (unusual fees flagged)
- Full spending analytics dashboard
- Settlement behavior insights
- UPI / Venmo / GPay deep links
- Friend graph across groups
- Recommendation engine (pre-assign frequent claimants)
- Aggregate user analytics telemetry (Supabase, V2 only)

---

## Known Approximations in Current Code

These are documented workarounds, not bugs. Each has a clear fix path.

| Approximation | Where | Fix |
|---|---|---|
| `settledAt` uses `expense.updated_at` when settled | `useBillRecords.ts` | Add `settled_at` column to `expenses` (SWE) |
| Item `category` defaults to `'other'` | `useBillRecords.ts` | Add `category` column to `line_items` (SWE) |
| `receipt_assets.storage_path` is local URI | `useReceiptAsset.ts` | Upload to Supabase Storage, store key (SWE) |
| `owed_amount` is 0 until split engine is wired | `expense_participants` | Wire `computeSplit` after item assignment (SWE) |
