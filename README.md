# SplitMate

**Transparent, itemized bill splitting — built for real bills, real groups, real clarity.**

Every bill splitter tells you what you owe. SplitMate tells you **why** — tracing every dollar from the original receipt line item, through tax and fee allocation, to the final settlement between friends.

---

## The Problem

| What existing apps do | What's missing |
|---|---|
| Split the total evenly | No item-level assignment |
| Ignore fee complexity | Delivery fees, platform fees, tips allocated incorrectly |
| "You owe $18" with no breakdown | No per-person explainability |
| Settlement with no context | No traceability to source bills |
| No memory of group spending | No analytics, trends, or fairness tracking |

## How SplitMate Solves It

- **Item-level assignment** — claim items or split shared dishes, not just totals
- **Fee rule engine** — delivery proportional to order value, tip on pre-tax subtotal, alcohol tax only to drinkers
- **Discount-before-tax ordering** — the engine enforces correct computation order regardless of how the receipt prints them
- **Per-person receipt** — every participant sees a traced breakdown: items + tax share + tip share = total owed
- **Settlement minimization** — greedy min-flow reduces 12 transfers to 3, each traced to source bills
- **On-device OCR** — Google ML Kit scans receipts locally; images never leave the device
- **Confidence-gated correction** — parser flags uncertain fields with amber highlights; high-confidence fields pre-fill silently
- **Spending analytics** — monthly reports, category breakdown, settlement streaks, spending personality (after 5+ bills)
- **Country-aware** — India (GST, CGST/SGST aggregation, INR) and USA (state sales tax, tips, USD)

---

## Screenshots

> *Run the app locally to see the full UI. Demo script: [DEMO_SCRIPT.md](DEMO_SCRIPT.md)*

| Dashboard | Bill Entry | Assignment | Settlement |
|---|---|---|---|
| Group list + create/join | Items + charges + OCR scan | Claim or split each item | Traceable transfers + mark paid |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile app | React Native + Expo SDK 52 + Expo Router 4 |
| Language | TypeScript 5.7 (strict mode) |
| Backend | Supabase (Postgres + Auth + Storage + RLS) |
| OCR | Google ML Kit on-device (~15MB, zero network calls) |
| Split engine | Deterministic, rule-based (never ML for money math) |
| Analytics | Pure functions on `BillRecord[]` — no DB calls inside the package |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Vitest — 125 tests across 3 packages |

---

## Project Structure

```
SplitMate/
├── apps/
│   └── mobile/                 Expo React Native app
│       ├── app/                Expo Router screens
│       │   ├── (auth)/         Login, signup
│       │   └── (app)/          Dashboard, groups, bills, settle, report
│       └── src/
│           ├── hooks/          Data hooks (useAuth, useGroups, useBills, useSettlements, useOcrScanner, ...)
│           ├── components/     Shared UI (FlaggedFieldHighlight)
│           └── lib/            Supabase client, auth helpers, invite code utils
├── packages/
│   ├── types/                  @splitmate/types — shared domain types
│   ├── split-engine/           @splitmate/split-engine — deterministic split + settlement
│   ├── ocr-parser/             @splitmate/ocr-parser — receipt text → ParsedBillDraft
│   └── analytics/              @splitmate/analytics — reports, personality, export
├── supabase/
│   ├── migrations/             SQL migrations 001–006
│   └── README.md               How to apply + verify migrations
├── docs/
│   └── SEED_DATA.md            Demo seed data instructions
└── DEMO_SCRIPT.md              3-minute demo runbook
```

---

## Database Schema

12 tables, all with Row Level Security enabled:

| Table | Purpose |
|---|---|
| `profiles` | User display info, auto-created on signup via trigger |
| `groups` | Currency, country, settlement mode, invite code |
| `group_members` | Membership with role (owner/member) |
| `expenses` | Bills with total, type, status, settled_at |
| `line_items` | Per-item rows with quantity, price, category |
| `line_item_participants` | Who claimed which item, with share weights |
| `charge_components` | Tax, tip, delivery, platform, discount — each with allocation rule |
| `expense_participants` | Per-user owed/paid amounts (engine-written) |
| `settlements` | Payment records between users |
| `settlement_expense_links` | Traceability: which bills a settlement covers |
| `receipt_assets` | Receipt image storage path + OCR parse metadata |
| `bill_rule_templates` | Saved split rules for recurring bills |

6 migrations applied in order. 3 SECURITY DEFINER RPC functions for safe cross-RLS operations.

---

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- A Supabase project ([supabase.com](https://supabase.com))

### Setup

```bash
# Clone
git clone https://github.com/YeshwanthBalaji0412/SplitMate.git
cd SplitMate

# Install
pnpm install

# Configure Supabase
cp .env.example apps/mobile/.env
# Edit apps/mobile/.env with your Supabase URL + anon key

# Apply database migrations (in Supabase SQL Editor, in order)
# See supabase/README.md for instructions
```

### Run

```bash
# Web (all features except OCR)
pnpm dev:mobile
# Then press 'w' for web, or open http://localhost:8081

# iOS (requires Xcode + dev client for OCR)
cd apps/mobile
npx expo prebuild --platform ios
npx expo run:ios

# Android (requires Android Studio + emulator)
cd apps/mobile
npx expo prebuild --platform android
npx expo run:android
```

### Test

```bash
# All 125 tests
pnpm test

# Individual packages
pnpm --filter @splitmate/split-engine test    # 34 tests
pnpm --filter @splitmate/ocr-parser test      # 66 tests
pnpm --filter @splitmate/analytics test       # 25 tests

# Type checking
pnpm typecheck
```

---

## Split Engine

The engine is **deterministic and rule-based** — no ML in the money layer.

**Computation order:**
1. Item subtotals from `line_item_participants` shares
2. Discounts (reduce post-discount base)
3. Taxes (allocated on post-discount base)
4. Fees (delivery proportional, platform equal, tip proportional, etc.)

**Rounding:** round once at the boundary (not mid-calculation). Penny leftover assigned deterministically to the highest-owing participant, ties broken by lexicographic user ID.

**Settlement:** greedy min-flow on net debt graph. Each transfer carries `expenseLinks[]` for traceability. Supports both `optimized` (minimum transfers) and `direct` (one transfer per expense) modes.

---

## OCR Pipeline

Three-stage parser: **classify** → **extract** → **assemble**.

| Stage | Input | Output |
|---|---|---|
| Classifier | `RawLine[]` + country | `ClassifiedLine[]` (item, tax, tip, total, noise, ...) |
| Extractor | `ClassifiedLine[]` | `ExtractedFields` (merchant, date, items, charges, totals) |
| Parser | `ExtractedFields` | `ParsedBillDraft` with confidence scores + flagged fields |

**Country-aware:**
- **India:** CGST/SGST detection and aggregation into single GST line, ₹/Rs/INR parsing, Zomato/Swiggy fee patterns
- **USA:** $ parsing, sales tax, tip/gratuity detection, DoorDash/UberEats patterns

**Item categorization:** food, alcohol, non_taxable, other — drives alcohol-tax-only allocation in the engine.

**Failure mode:** never throws. Bad OCR input returns a partial/empty draft with all fields flagged.

---

## Analytics

Pure functions on `BillRecord[]` — no database calls inside the package.

| Feature | Function |
|---|---|
| Monthly report | `computeMonthlyReport(records, userId)` — total, breakdown, streak |
| Spending personality | `derivePersonality(records, userId)` — Splurger / Even-Steven / Optimizer / Settler (5+ bills) |
| Settlement streak | `computeSettlementStreak(records)` — consecutive bills settled within 48h |
| Storage estimate | `estimateStorage(records)` — archivable bills (settled 3+ months) |
| Export | `exportToCSV(records, userId)` / `exportToJSON(records)` |

---

## Team

| Name | Role | Scope |
|---|---|---|
| **Yeshwanth Balaji** | SWE Lead | Architecture, schema, split engine, settlement, mobile app, backend |
| **Sruthi** | MLE Lead | OCR pipeline, item classification, confidence scoring, analytics |

---

## Build Status

| Component | Tests | Status |
|---|---|---|
| Split engine | 34 | Passing |
| OCR parser | 66 | Passing |
| Analytics | 25 | Passing |
| TypeScript (5 packages) | — | Clean |
| Database (12 tables + RLS) | — | Applied |
| Mobile app (web) | — | Demo-ready |
| Mobile app (native/OCR) | — | Requires iOS 16+ sim |

---

## License

This project was built as an academic/portfolio project. Not yet licensed for production distribution.
