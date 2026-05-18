# MLE Engineering Log — SplitMate

**Owner:** Sruthi (ML Engineering Lead)
**Scope:** OCR pipeline, item classification, confidence scoring, longitudinal intelligence, spending analytics
**Roadmap reference:** [PLAN.md](PLAN.md)

---

## Status Overview

| Module | Package | Branch | Status | Tests |
|---|---|---|---|---|
| Item classifier | `ocr-parser` | `data_schema` → main | **Complete** | 57 |
| Field extractor | `ocr-parser` | `data_schema` → main | **Complete** | 40 |
| Receipt parser | `ocr-parser` | `data_schema` → main | **Complete** | 7 real receipts (snapshot) |
| Analytics aggregator | `analytics` | `layer2-intelligence` → main | **Complete** | 32 |
| Spending personality | `analytics` | `layer2-intelligence` → main | **Complete** | covered via aggregator |
| Storage manager | `analytics` | `layer2-intelligence` → main | **Complete** | 11 |
| Report exporter | `analytics` | `layer2-intelligence` → main | **Complete** | 10 |
| ML Kit integration | `mobile` | `mlkit-integration` | **In progress** | — |
| **Confidence correction UX** | `mobile` | next branch | **Up next** | — |
| SQLite query layer | `mobile` | after correction UX | Not started | — |

---

## What's Done

### OCR Parser — `packages/ocr-parser`

Three-stage pipeline: classify → extract → parse. Runs entirely in TypeScript, takes raw ML Kit text lines as input.

**Classifier** — labels each receipt line as one of:
`item | tax_line | fee_line | discount | tip | total | noise`
Then for items: `food | alcohol | non_taxable | other`
Country-aware: detects CGST/SGST pairs (India), state sales tax (US), ₹ vs $ symbol ambiguity.

**Extractor** — pulls structured fields from classified lines:
merchant name, date, subtotal, tax lines, fee lines, tip, total, line items with quantities and unit prices.
India mode: aggregates CGST + SGST into a single GST line, flags MRP-inclusive prices.
US mode: pre-tax item prices, additive tax at bottom.

**Parser** — assembles extractor output into bill JSON draft with per-field confidence scores and a `flagged_fields` array.
Low-confidence fields go in `flagged_fields` — surfaced to user for correction. High-confidence fields pre-filled silently.
Parse failure produces an empty draft with all fields flagged — never a crash, always falls back to manual entry.

**Real receipt coverage:** 7 fixture files — 2 Indian (delivery, restaurant), 5 US (2 delivery, 3 grocery). Snapshot-tested.

---

### Analytics Layer 2 — `packages/analytics`

Longitudinal intelligence layer. Takes `BillRecord[]` from the caller, returns plain objects. No database calls inside the package — fully unit-testable.

**Aggregator** — `computeMonthlyReport`: category breakdown, per-group summary, fairness delta, avg days to settle, settlement streak. Calls personality.

**Spending personality** — `derivePersonality`: 4 types (Splurger, Even-Steven, Optimizer, Settler). Requires 5+ bills lifetime. Deterministic — same bills always produce same result.

**Storage manager** — `estimateStorage`, `getArchivableBills`: identifies bills eligible for archiving (settled 3+ months ago). Shown to user before they delete.

**Report exporter** — `exportToJSON`, `exportToCSV`, `importFromJSON`: RFC 4180 CSV, round-trip JSON. Caller writes to device filesystem.

---

## What's Next — One Module at a Time

### Module 4 — ML Kit Integration ✓ in progress
**Branch:** `mlkit-integration`
**Depends on:** `country` field on groups (✓), `receipt_assets.parse_metadata` (✓)

**Built:**

`useOcrScanner(country, billType)` — 5-state machine (`idle → picking → processing → done | failed`). Requests camera roll permission, launches image picker, passes image URI to ML Kit, flattens the block/line/element hierarchy into `RawLine[]`, calls `parseReceipt`, returns `ParsedBillDraft`.

`useReceiptAsset()` — Supabase lifecycle for `receipt_assets`: `createAsset` inserts with `status=processing`, `markDone` writes `parse_metadata` (confidence scores, flagged fields, item/charge counts) + `status=done`, `markFailed` writes the error reason.

`bill-entry.tsx` — scan button pre-fills merchant name, bill type, items, and charges from the draft. Green badge shows flagged field count. Scan failure is a non-blocking alert — manual entry always works.

**Open item for Yeshwanth:** `storage_path` in `receipt_assets` currently holds the local image URI. Needs a Supabase Storage upload step so the path becomes a real storage key. MLE side is complete — this is a SWE task.

---

### Module 5 — Confidence Correction UX
**Branch:** off `main` after Module 4 merges
**Depends on:** ML Kit integration complete, bill entry screen from SWE

Surface low-confidence fields to the user for review:
- `flagged_fields` from parser → highlighted in bill entry form (yellow border, "tap to confirm")
- High-confidence fields pre-filled, no highlight — user ignores them unless wrong
- User corrects → field confidence overridden to 1.0, removed from `flagged_fields`
- "All fields confirmed" → bill draft is promoted to `active`

**Deliverable:** User sees exactly what the parser was uncertain about and nothing else. One tap per flagged field to confirm or correct.

---

### Module 6 — SQLite Query Layer
**Branch:** off `main` after Module 5 merges
**Depends on:** Supabase sync wired by SWE, analytics package complete (✓)

The `analytics` package takes `BillRecord[]` — someone has to fetch those from the local database. This module is the bridge:

- Query layer: `getBillsForUser(userId, window)` → `BillRecord[]` from SQLite
- Maps Supabase/SQLite rows to the `BillRecord` shape the analytics package expects
- Called by the monthly report screen: fetch → pass to `computeMonthlyReport` → render

**Deliverable:** Monthly report screen shows real data from the user's local bill history.

---

## Design Decisions

### 2026-05-11 — ML Kit on-device, not Ollama or cloud LLM

**Decision:** OCR uses Google ML Kit running fully on-device.

**Ollama ruled out:** Desktop/server runtime — cannot run on Android or iOS.

**Cloud LLM APIs ruled out:** Providers retain API inputs up to 30 days. Receipt images are sensitive financial data (card digits, merchant locations, purchase patterns). Firm product decision, not a cost decision.

**ML Kit:** On-device, ~15MB, Android + iOS native, zero network calls. Raw text feeds our parsing logic — intelligence lives in code, not a model.

---

### 2026-05-10 — OCR output is a draft, not a source of truth

**Decision:** Every parsed field carries a confidence score. Only low-confidence fields are surfaced for correction. High-confidence fields pre-filled silently.

**Why:** Reviewing every field is friction. Zero review creates trust issues. Confidence-gated correction earns trust — the app is right quietly and asks only when uncertain.

---

### 2026-05-10 — Country-aware parsing from day one

**Decision:** India and USA handled as distinct parsing modes, selected by group `country` field.

**Why:** Indian bills show CGST/SGST inline, prices often GST-inclusive, ₹ has OCR ambiguity. US bills show pre-tax items, tax at bottom. One generic format produces wrong field mappings.

---

### 2026-05-10 — All input modalities funnel to the same schema

**Decision:** Photo, screenshot, PDF, and manual entry all produce the same bill JSON schema.

**Why:** Split engine, explainability view, and settlement must never care how a bill was entered. Coupling them to input modality creates parallel code paths.

---

### 2026-05-18 — Analytics package is DB-agnostic by design

**Decision:** `packages/analytics` takes plain arrays, returns plain objects. Zero database calls inside the package.

**Why:** Keeps every function unit-testable with hardcoded data. Decouples analytics from whatever DB shape SWE uses. The query layer (Module 6) is a thin adapter — if the DB schema changes, only the adapter changes, not the analytics logic.

---

### 2026-05-18 — Supabase sync from day one, SQLite as primary

**Decision:** SQLite is the primary local store. Supabase syncs group bills, membership, and settlements so all members stay in sync. Receipt images never leave the device.

**Why:** Group sync is a core requirement — members need to see each other's bills. Local-first means offline works and split math never hits the network. These are not in conflict.

**V2 addition:** Aggregate user analytics telemetry (spend trends, retention signals across users) added on top of the same Supabase instance when needed. Individual bill data is not involved.

---

## Open Questions

- [ ] Minimum bill history before Layer 2 insights are shown — currently 5 bills for personality, need to decide for fairness delta and settlement streak
- [ ] How to handle flat-total bills (no itemization) in the classifier — currently falls through to manual assignment
- [ ] PDF parsing (V1): native text extraction first, ML Kit OCR fallback for scanned PDFs

---

## Release Log

| Date | Module | Update |
|---|---|---|
| 2026-05-10 | — | MLE scope defined, design decisions logged |
| 2026-05-14 | OCR parser | Classifier, extractor, parser complete — 91 tests, 7 real receipts |
| 2026-05-14 | Analytics | Aggregator and personality complete — 32 tests |
| 2026-05-18 | Analytics | Storage manager and exporter complete — 21 tests, all modules done |
| 2026-05-18 | — | All MLE branches merged to main. ML Kit integration is next. |
| 2026-05-18 | ML Kit integration | `useOcrScanner` + `useReceiptAsset` + bill-entry pre-fill complete. On `mlkit-integration` branch. |
